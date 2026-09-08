import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { isWbGlobalRateLimit } from "@/lib/wb/rateLimit";
import {
  checkPaidStorageTaskStatus,
  createPaidStorageTask,
  downloadPaidStorageTask,
  type PaidStorageApiRow,
} from "@/lib/wb/paidStorageRequest";

export const maxDuration = 60;

const JOB = "paid_storage";
// WB отдаёт «Платное хранение» с задержкой в 1-2 суток — вчерашний день ещё
// может быть не досчитан, поэтому не запрашиваем его сразу.
const REPORT_LAG_DAYS = 2;
// Небольшое окно за запрос — быстрее закрывает разрывы и меньше данных
// теряется при ошибке одной задачи.
const WINDOW_DAYS = 7;
const HISTORY_DEPTH_DAYS = 180;

interface PaidStorageJobState extends Record<string, unknown> {
  taskId?: string;
  periodStart?: string;
  periodEnd?: string;
  createdAt?: string;
  /**
   * Бэкфилл идёт от СЕГОДНЯ НАЗАД, а не от истории вперёд: пользователю
   * важна прежде всего текущая/прошлая неделя в ОПиУ, а не глубина
   * истории. frontier — самая ранняя уже загруженная дата; следующее окно
   * берётся сразу перед ней. Без этого первая неделя после мёржа PR ждала
   * бы своей очереди несколько суток, пока догоняется 180-дневная история.
   */
  frontier?: string;
  historyStart?: string;
  lastRunAt?: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function rowId(cabinetId: string, row: PaidStorageApiRow): string {
  const date = String(row.date ?? "").slice(0, 10);
  return [cabinetId, date, row.barcode ?? "", row.giId ?? "", row.chrtId ?? "", row.calcType ?? ""].join("|");
}

export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const allTargets = await getWbSyncTargets();
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const targets = onlyCabinet ? allTargets.filter((t) => t.cabinetId === onlyCabinet) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов" }, { status: 500 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const today = isoDate(new Date());
  const maxAllowedDate = addDays(today, -REPORT_LAG_DAYS);

  let total = 0;
  const errors: string[] = [];
  const deferred: string[] = [];
  const progress: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    if (!target.cabinetId) continue;
    const cabinetId = target.cabinetId;

    if (!(await claimWbSyncJob(db, cabinetId, JOB, 15 * 60))) {
      progress.push({ cabinet: target.name, status: "running", skipped: true });
      continue;
    }

    try {
      const saved = await readWbSyncState<PaidStorageJobState>(db, cabinetId, JOB);
      const state: PaidStorageJobState = saved?.state ?? {};

      // Задача уже создана в прошлый прогон — проверяем статус.
      if (state.taskId) {
        const statusRes = await checkPaidStorageTaskStatus(target.statsToken, state.taskId);
        if (!statusRes.ok) {
          const rateLimited = isWbGlobalRateLimit(statusRes.status, statusRes.body);
          if (rateLimited) {
            deferred.push(`${target.name}: лимит WB на проверке статуса`);
            progress.push({ cabinet: target.name, status: "deferred" });
          } else {
            errors.push(`${target.name}: статус задачи WB ${statusRes.status}: ${statusRes.body}`);
            await writeWbSyncState(db, cabinetId, JOB, {
              cursor: saved?.cursor ?? null,
              status: "error",
              attempts: (saved?.attempts ?? 0) + 1,
              lastError: statusRes.body,
              state,
            });
          }
          continue;
        }

        if (statusRes.status === "processing") {
          progress.push({ cabinet: target.name, status: "pending", taskId: state.taskId });
          await writeWbSyncState(db, cabinetId, JOB, {
            cursor: saved?.cursor ?? null,
            status: "backfill",
            attempts: 0,
            lastError: null,
            state: { ...state, lastRunAt: startedAt.toISOString() },
          });
          continue;
        }

        if (statusRes.status === "purged" || statusRes.status === "canceled" || statusRes.status === "unknown") {
          // Задачу протухла/отменена — забываем taskId, следующий прогон создаст новую на то же окно.
          await writeWbSyncState(db, cabinetId, JOB, {
            cursor: saved?.cursor ?? null,
            status: "backfill",
            attempts: (saved?.attempts ?? 0) + 1,
            lastError: `задача WB ${statusRes.status}`,
            state: { ...state, taskId: undefined, lastRunAt: startedAt.toISOString() },
          });
          progress.push({ cabinet: target.name, status: statusRes.status, retry: true });
          continue;
        }

        // status === "done"
        const download = await downloadPaidStorageTask(target.statsToken, state.taskId);
        if (!download.ok) {
          const rateLimited = isWbGlobalRateLimit(download.status, download.body);
          if (rateLimited) {
            deferred.push(`${target.name}: лимит WB на скачивании`);
            progress.push({ cabinet: target.name, status: "deferred" });
          } else {
            errors.push(`${target.name}: скачивание WB ${download.status}: ${download.body}`);
            await writeWbSyncState(db, cabinetId, JOB, {
              cursor: saved?.cursor ?? null,
              status: "error",
              attempts: (saved?.attempts ?? 0) + 1,
              lastError: download.body,
              state,
            });
          }
          continue;
        }

        const rows = download.rows.map((row) => ({
          id: rowId(cabinetId, row),
          cabinet_id: cabinetId,
          date: String(row.date ?? "").slice(0, 10),
          nm_id: row.nmId ?? null,
          vendor_code: row.vendorCode ?? null,
          barcode: row.barcode ?? null,
          subject: row.subject ?? null,
          brand: row.brand ?? null,
          warehouse: row.warehouse ?? null,
          office_id: row.officeId ?? null,
          gi_id: row.giId ?? null,
          chrt_id: row.chrtId ?? null,
          size: row.size ?? null,
          volume: row.volume ?? null,
          calc_type: row.calcType ?? null,
          warehouse_price: row.warehousePrice ?? 0,
          barcodes_count: row.barcodesCount ?? null,
          synced_at: new Date().toISOString(),
        })).filter((r) => r.date);

        const upsertError = await chunkedUpsert("wb_paid_storage_rows", rows, "id");
        if (upsertError) {
          errors.push(`${target.name}: запись wb_paid_storage_rows: ${upsertError}`);
          await writeWbSyncState(db, cabinetId, JOB, {
            cursor: saved?.cursor ?? null,
            status: "error",
            attempts: (saved?.attempts ?? 0) + 1,
            lastError: upsertError,
            state,
          });
          continue;
        }

        total += rows.length;
        const frontier = state.periodStart ?? state.frontier ?? maxAllowedDate;
        const historyStart = state.historyStart ?? addDays(today, -HISTORY_DEPTH_DAYS);
        await writeWbSyncState(db, cabinetId, JOB, {
          cursor: frontier,
          status: frontier <= historyStart ? "caught_up" : "backfill",
          attempts: 0,
          lastError: null,
          state: {
            ...state,
            taskId: undefined,
            frontier,
            historyStart,
            lastRunAt: new Date().toISOString(),
          },
        });
        progress.push({ cabinet: target.name, status: "downloaded", rows: rows.length, period: { start: state.periodStart, end: state.periodEnd } });
        continue;
      }

      // Нет активной задачи — окно берём НАЗАД от frontier (при первом
      // запуске — от maxAllowedDate, т.е. с самых свежих дней).
      const historyStart = state.historyStart ?? addDays(today, -HISTORY_DEPTH_DAYS);
      const periodEnd = state.frontier ? addDays(state.frontier, -1) : maxAllowedDate;
      if (periodEnd < historyStart) {
        progress.push({ cabinet: target.name, status: "caught_up" });
        await writeWbSyncState(db, cabinetId, JOB, {
          cursor: state.frontier ?? null,
          status: "caught_up",
          attempts: 0,
          lastError: null,
          state: { ...state, historyStart, lastRunAt: new Date().toISOString() },
        });
        continue;
      }
      const windowStart = addDays(periodEnd, -(WINDOW_DAYS - 1));
      const periodStart = windowStart < historyStart ? historyStart : windowStart;

      const created = await createPaidStorageTask(target.statsToken, periodStart, periodEnd);
      if (!created.ok) {
        const rateLimited = isWbGlobalRateLimit(created.status, created.body);
        if (rateLimited) {
          deferred.push(`${target.name}: лимит WB на создании задачи`);
          progress.push({ cabinet: target.name, status: "deferred" });
        } else {
          errors.push(`${target.name}: создание задачи WB ${created.status}: ${created.body}`);
          await writeWbSyncState(db, cabinetId, JOB, {
            cursor: state.frontier ?? null,
            status: "error",
            attempts: (saved?.attempts ?? 0) + 1,
            lastError: created.body,
            state: { ...state, historyStart },
          });
        }
        continue;
      }

      await writeWbSyncState(db, cabinetId, JOB, {
        cursor: state.frontier ?? null,
        status: "backfill",
        attempts: 0,
        lastError: null,
        state: {
          ...state,
          taskId: created.taskId,
          periodStart,
          periodEnd,
          historyStart,
          createdAt: new Date().toISOString(),
        },
      });
      progress.push({ cabinet: target.name, status: "created", taskId: created.taskId, period: { periodStart, periodEnd } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${target.name}: ${message}`);
    }
  }

  const nothingCollected = total === 0 && progress.every((p) => p.status !== "downloaded");
  const allDeferred = deferred.length > 0 && nothingCollected;
  const ok = errors.length === 0 && !allDeferred;
  const logNote = errors.join("; ") || (allDeferred ? `не обновлено: ${deferred.join("; ")}` : null);
  await writeSyncLog(JOB, ok ? "ok" : "error", total, logNote, startedAt);

  return NextResponse.json({ ok, total, progress, errors, deferred });
}
