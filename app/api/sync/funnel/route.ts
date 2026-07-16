import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { getWbSyncTargets } from "@/lib/sync/cabinets";
import {
  funnelGapRecoveryPeriod,
  rotateFunnelTargets,
  runFunnelTargetsConcurrently,
  syncFunnelPeriod,
} from "@/lib/wb/funnelPeriod";
import { fetchWbFunnelHistory } from "@/lib/wb/funnelRequest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { allowsNm } from "@/lib/wb/productScope";
import { isWbGlobalRateLimit } from "@/lib/wb/rateLimit";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";
import { closedMoscowDates } from "@/lib/wb/sklejki";

const HISTORY_URL =
  "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products/history";
const NM_BATCH = 20;
const RATE_LIMIT_WAIT_MS = 21_000;
const REQUEST_RESERVE_MS = 5_000;

// воронка с паузами 21с между батчами (на кабинет) может идти дольше дефолта
export const maxDuration = 60;

interface HistoryDay {
  date?: string;
  openCount?: number;
  cartCount?: number;
  orderCount?: number;
  orderSum?: number;
  buyoutCount?: number;
  buyoutSum?: number;
}

interface HistoryItem {
  product?: { nmId?: number };
  history?: HistoryDay[];
}

interface FunnelCoverageRow { nm_id: number; date: string }

// nm_id, по которым тянем воронку, в разрезе кабинета (остатки + заказы за 30 дней).
async function nmIdsForCabinet(db: SupabaseClient, cabinetId: string | null): Promise<number[]> {
  const stockRows = await loadAllSupabasePages<{ nm_id: number }>((from, to) => {
    let query = db.from("wb_stocks").select("nm_id").order("nm_id", { ascending: true }).range(from, to);
    query = cabinetId === null ? query.is("cabinet_id", null) : query.eq("cabinet_id", cabinetId);
    return query;
  }, { maxPages: 1_000, label: "SKU остатков для воронки" });
  const orderRows = await loadAllSupabasePages<{ nm_id: number }>((from, to) => {
    let query = db
      .from("wb_orders")
      .select("nm_id")
      .gte("date", new Date(Date.now() - 30 * 86400000).toISOString())
      .order("nm_id", { ascending: true })
      .range(from, to);
    query = cabinetId === null ? query.is("cabinet_id", null) : query.eq("cabinet_id", cabinetId);
    return query;
  }, { maxPages: 1_000, label: "SKU заказов для воронки" });

  return [
    ...new Set([
      ...stockRows.map((r) => r.nm_id as number),
      ...orderRows.map((r) => r.nm_id as number),
    ]),
  ];
}

export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const allTargets = await getWbSyncTargets();
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const targets = onlyCabinet ? allTargets.filter((target) => target.cabinetId === onlyCabinet) : allTargets;
  if (!targets.length) {
    return NextResponse.json({ error: "Нет активных кабинетов и WB_STATS_TOKEN не настроен" }, { status: 500 });
  }

  const defaultPeriod = syncFunnelPeriod(request.url); // история доступна до вчера; по понедельникам восстанавливаем последние 7 дней.
  // Синхронный history endpoint разрешает только последние семь закрытых дней.
  // Более старые разрывы восстанавливает DETAIL_HISTORY_REPORT в syncRecovery.
  const recoveryDates = closedMoscowDates(7);

  let total = 0;
  const errors: string[] = [];
  const rotated: string[] = [];
  const progress: Array<Record<string, unknown>> = [];

  // Бюджет на джобу (60с-функция): успеть upsert и лог. Внутри окна — несколько батчей.
  // Оставляем 15с от Vercel maxDuration на финальный upsert и sync_log.
  const deadline = Date.now() + 45_000;
  // Срез дня для ротации (разные SKU в разные дни — полное покрытие за неск. прогонов).
  const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000);
  // Каждый кабинет — отдельный seller-account и отдельный лимит WB. Кабинеты
  // запускаем параллельно, а батчи внутри одного кабинета оставляем с паузой 21с.
  const rotatedTargets = rotateFunnelTargets(targets, dayOfYear);

  try {
    await runFunnelTargetsConcurrently(rotatedTargets, async (t) => {
      if (Date.now() + REQUEST_RESERVE_MS > deadline) {
        rotated.push(`${t.name}: пропущен (бюджет)`);
        return;
      }
      const previous = t.cabinetId ? await readWbSyncState(db, t.cabinetId, "funnel") : null;
      if (t.cabinetId && !(await claimWbSyncJob(db, t.cabinetId, "funnel", 15 * 60))) {
        rotated.push(`${t.name}: уже выполняется`);
        return;
      }
      const nmIds = (await nmIdsForCabinet(db, t.cabinetId))
        .filter((nmId) => allowsNm(t.productScope, nmId))
        .sort((left, right) => left - right);
      if (!nmIds.length) {
        if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "funnel", {
          cursor: "0", status: "caught_up", attempts: 0, lastError: null,
          state: { nextBatch: 0, totalBatches: 0, totalSku: 0, coveragePct: 100, maxAgeHours: 0, lastSyncedAt: new Date().toISOString() },
        });
        progress.push({ cabinet: t.name, totalSku: 0, coveragePct: 100, nextBatch: 0 });
        return;
      }

      // батчи SKU; стартуем со сдвигом по дню, идём по кругу
      const batches: number[][] = [];
      for (let i = 0; i < nmIds.length; i += NM_BATCH) batches.push(nmIds.slice(i, i + NM_BATCH));
      const savedBatch = Number(previous?.state.nextBatch);
      const startB = batches.length
        ? (Number.isInteger(savedBatch) && savedBatch >= 0 ? savedBatch : dayOfYear) % batches.length
        : 0;
      if (batches.length > 1) rotated.push(`${t.name}: срез ${startB + 1}/${batches.length}`);
      const batch = batches[startB];
      let period = defaultPeriod;
      if (defaultPeriod.mode !== "manual") {
        let coverageQuery = db
          .from("wb_funnel_daily")
          .select("nm_id, date")
          .in("nm_id", batch)
          .gte("date", recoveryDates[0])
          .lte("date", recoveryDates[recoveryDates.length - 1]);
        coverageQuery = t.cabinetId === null
          ? coverageQuery.is("cabinet_id", null)
          : coverageQuery.eq("cabinet_id", t.cabinetId);
        const coverageResult = await coverageQuery;
        if (coverageResult.error) {
          const message = `проверка истории: ${coverageResult.error.message}`;
          errors.push(`${t.name}: ${message}`);
          if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "funnel", {
            cursor: String(startB), status: "error", attempts: (previous?.attempts ?? 0) + 1, lastError: message,
            state: { ...(previous?.state ?? {}), nextBatch: startB, totalBatches: batches.length, totalSku: nmIds.length },
          });
          return;
        }
        period = funnelGapRecoveryPeriod(
          recoveryDates,
          batch,
          (coverageResult.data ?? []) as FunnelCoverageRow[],
          defaultPeriod,
        );
      }
      const res = await fetchWbFunnelHistory({
        url: HISTORY_URL,
        token: t.statsToken,
        body: JSON.stringify({ nmIds: batch, selectedPeriod: { start: period.begin, end: period.end } }),
        deadline,
        reserveMs: REQUEST_RESERVE_MS,
        fallbackWaitMs: RATE_LIMIT_WAIT_MS,
      });
      if (!res.ok) {
        const message = `WB ${res.status}: ${(await res.text()).slice(0, 120)}`;
        if (isWbGlobalRateLimit(res.status, message)) {
          rotated.push(`${t.name}: лимит WB funnel, повторим срез ${startB + 1}/${batches.length || 1}`);
          if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "funnel", {
            cursor: String(startB), status: "running", attempts: 0, lastError: null,
            state: {
              ...(previous?.state ?? {}),
              nextBatch: startB,
              totalBatches: batches.length,
              totalSku: nmIds.length,
              lastRateLimitedAt: new Date().toISOString(),
            },
          });
          progress.push({ cabinet: t.name, status: "rate_limited", batch: startB + 1, batches: batches.length, nextBatch: startB, period });
          return;
        }
        errors.push(`${t.name}: ${message}`);
        if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "funnel", {
          cursor: String(startB), status: "error", attempts: (previous?.attempts ?? 0) + 1, lastError: message,
          state: { ...(previous?.state ?? {}), nextBatch: startB, totalBatches: batches.length, totalSku: nmIds.length },
        });
        return;
      }

      const rows: Record<string, unknown>[] = [];
      const json = (await res.json()) as HistoryItem[];
      for (const item of json ?? []) {
        const nmId = item.product?.nmId;
        if (!nmId || !allowsNm(t.productScope, nmId)) continue;
        for (const day of item.history ?? []) {
          if (!day.date) continue;
          rows.push({
            nm_id: nmId,
            date: day.date.slice(0, 10),
            open_card: day.openCount ?? 0,
            add_to_cart: day.cartCount ?? 0,
            orders: day.orderCount ?? 0,
            orders_sum: day.orderSum ?? 0,
            buyouts: day.buyoutCount ?? 0,
            buyout_sum: day.buyoutSum ?? 0,
            cabinet_id: t.cabinetId,
          });
        }
      }
      const upsertError = rows.length ? await chunkedUpsert("wb_funnel_daily", rows, "nm_id,date") : null;
      if (upsertError) {
        errors.push(`${t.name}: ${upsertError}`);
        if (t.cabinetId) await writeWbSyncState(db, t.cabinetId, "funnel", {
          cursor: String(startB), status: "error", attempts: (previous?.attempts ?? 0) + 1, lastError: upsertError,
          state: { ...(previous?.state ?? {}), nextBatch: startB, totalBatches: batches.length, totalSku: nmIds.length },
        });
        return;
      }
      total += rows.length;
      const nextBatch = (startB + 1) % batches.length;
      const processedSku = nextBatch === 0
        ? nmIds.length
        : Math.min(nmIds.length, Number(previous?.state.processedSku ?? 0) + batch.length);
      const coveragePct = Math.round(processedSku / nmIds.length * 1_000) / 10;
      const syncedAt = new Date().toISOString();
      if (t.cabinetId) {
        const stateError = await writeWbSyncState(db, t.cabinetId, "funnel", {
          cursor: String(nextBatch),
          status: nextBatch === 0 ? "caught_up" : "running",
          attempts: 0,
          lastError: null,
          state: {
            nextBatch,
            totalBatches: batches.length,
            totalSku: nmIds.length,
            processedSku: nextBatch === 0 ? 0 : processedSku,
            coveragePct,
            maxAgeHours: nextBatch === 0 ? 0 : Math.max(1, batches.length - startB - 1),
            lastSyncedAt: syncedAt,
            lastPeriod: period,
          },
        });
        if (stateError) errors.push(`${t.name}: состояние funnel: ${stateError}`);
      }
      progress.push({ cabinet: t.name, batch: startB + 1, batches: batches.length, sku: batch.length, coveragePct, nextBatch, period });
    });

    const ok = errors.length === 0;
    const note = rotated.length ? ` [ротация: ${rotated.join(", ")}]` : "";
    await writeSyncLog("funnel", ok ? "ok" : "error", total, errors.length ? (errors.join("; ") + note).trim() : null, startedAt);
    return NextResponse.json(
      { ok, rows: total, cabinets: targets.length, period: defaultPeriod, progress, rotated, errors },
      { status: ok ? 200 : 502 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await writeSyncLog("funnel", "error", null, msg, startedAt);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
