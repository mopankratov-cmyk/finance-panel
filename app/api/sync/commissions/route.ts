import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth, chunkedUpsert, writeSyncLog } from "@/lib/sync/helpers";
import { cabinetProductScope, getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import {
  accumulateCommissionRows,
  commissionFromAccumulator,
  emptyCommissionAccumulator,
  type CommissionAccumulator,
  type ReportRow,
} from "@/lib/wb/commissions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { rotatingSyncTargets, stalestSyncTargets } from "@/lib/sync/rotation";
import { fetchWbReportPage, WbReportDeadlineError } from "@/lib/wb/reportPagination";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";

// Finance API допускает только один запрос в минуту (burst 1). Даже отчёт из
// одной страницы требует второй запрос через минуту, чтобы получить финальный
// 204, поэтому стандартных 60 секунд недостаточно для корректной пагинации.
export const maxDuration = 300;

const RUN_BUDGET_MS = 280_000;
const NEXT_PAGE_BUDGET_MS = 70_000;
const COMMISSION_REPORT_FIELDS = [
  "rrdId", "nmId", "brandName", "sellerOperName", "bonusTypeName",
  "commissionPercent", "ppvzSalesCommission", "acquiringFee",
  "retailPriceWithDisc", "retailAmount", "deliveryService", "paidStorage",
  "penalty", "paidAcceptance", "deduction",
];

interface CommissionSyncState extends Record<string, unknown> {
  periodFrom: string;
  periodTo: string;
  pages: number;
  accumulator?: CommissionAccumulator;
  coveragePct: number;
  cycleStartedAt: string;
  lastSyncedAt?: string;
  completedAt?: string;
}

function savedAccumulator(value: unknown): CommissionAccumulator | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CommissionAccumulator>;
  if (!candidate.byNm || typeof candidate.byNm !== "object") return null;
  return {
    byNm: candidate.byNm,
    totalWeightedCommission: Number(candidate.totalWeightedCommission ?? 0),
    totalAcquiring: Number(candidate.totalAcquiring ?? 0),
    totalRevenue: Number(candidate.totalRevenue ?? 0),
    totalExtra: Number(candidate.totalExtra ?? 0),
    noNmExtra: Number(candidate.noNmExtra ?? 0),
  };
}

// Наполняет wb_nm_commissions/wb_cabinet_commission_overhead — кэш факт-комиссии по nm,
// чтобы РНП/юнит не платили ~12с холодного финотчёта на каждый кабинет на каждом запросе
// (см. lib/wb/commissions.ts). Полный финотчёт одного большого кабинета занимает
// несколько минут, поэтому почасовой cron обходит кабинеты по кругу.
export async function GET(request: NextRequest) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  const startedAt = new Date();
  const allCabs = await getActiveWbCabinets();
  const onlyCabinet = request.nextUrl.searchParams.get("cabinet");
  const runAll = request.nextUrl.searchParams.get("all") === "1";
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const deadline = Date.now() + RUN_BUDGET_MS;
  let cabs = rotatingSyncTargets(allCabs, { requestedId: onlyCabinet, runAll });
  if (!onlyCabinet && !runAll && db && allCabs.length > 1) {
    const { data: freshness, error: freshnessError } = await db
      .from("wb_cabinet_commission_overhead")
      .select("cabinet_id, synced_at")
      .in("cabinet_id", allCabs.map((cabinet) => cabinet.id));
    if (!freshnessError) {
      const syncedAtById = new Map((freshness ?? []).map((row) => [String(row.cabinet_id), row.synced_at as string | null]));
      cabs = stalestSyncTargets(allCabs, syncedAtById);
    }
  }
  if (onlyCabinet && !cabs.length) {
    return NextResponse.json({ ok: false, error: "WB-кабинет не найден" }, { status: 404 });
  }
  if (!cabs.length) return NextResponse.json({ ok: true, rows: 0, cabinets: 0 });

  let total = 0;
  const errors: string[] = [];
  const progress: Array<Record<string, unknown>> = [];

  for (const cab of cabs) {
    if (Date.now() + NEXT_PAGE_BUDGET_MS >= deadline) {
      progress.push({ cabinet: cab.name, status: "deferred", reason: "execution_budget" });
      continue;
    }
    const previous = await readWbSyncState<CommissionSyncState>(db, cab.id, "commissions");
    if (!(await claimWbSyncJob(db, cab.id, "commissions", 6 * 60))) {
      progress.push({ cabinet: cab.name, status: "running", skipped: true });
      continue;
    }

    const restoredAccumulator = previous
      && previous.status !== "caught_up"
      && typeof previous.state.periodFrom === "string"
      && typeof previous.state.periodTo === "string"
      && typeof previous.state.cycleStartedAt === "string"
      ? savedAccumulator(previous.state.accumulator)
      : null;
    const resumable = Boolean(restoredAccumulator);
    const today = new Date().toISOString().slice(0, 10);
    const periodTo = resumable ? previous!.state.periodTo : today;
    const periodFrom = resumable
      ? previous!.state.periodFrom
      : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const cycleStartedAt = resumable ? previous!.state.cycleStartedAt : new Date().toISOString();
    let cursor = resumable ? Number(previous?.cursor ?? 0) : 0;
    let accumulator = restoredAccumulator ?? emptyCommissionAccumulator();
    let pages = resumable ? Number(previous!.state.pages ?? 0) : 0;
    let pagesThisRun = 0;
    let complete = false;

    try {
      while (Date.now() + NEXT_PAGE_BUDGET_MS < deadline) {
        let page;
        try {
          page = await fetchWbReportPage<ReportRow>({
            token: cab.token,
            dateFrom: periodFrom,
            dateTo: periodTo,
            initialRrdId: cursor,
            fields: COMMISSION_REPORT_FIELDS,
            deadlineMs: deadline,
          });
        } catch (error) {
          if (error instanceof WbReportDeadlineError) break;
          throw error;
        }
        if (page.complete) {
          complete = true;
          break;
        }

        accumulator = accumulateCommissionRows(accumulator, page.rows, cabinetProductScope(cab));
        cursor = page.lastRrdId;
        pages++;
        pagesThisRun++;
        const stateError = await writeWbSyncState(db, cab.id, "commissions", {
          cursor: String(cursor),
          status: "running",
          attempts: 0,
          lastError: null,
          state: {
            periodFrom, periodTo, pages, accumulator, coveragePct: 50, cycleStartedAt,
            ...(previous?.state.lastSyncedAt ? { lastSyncedAt: previous.state.lastSyncedAt } : {}),
          },
        });
        if (stateError) throw new Error(`состояние commissions: ${stateError}`);
      }

      if (!complete) {
        const stateError = await writeWbSyncState(db, cab.id, "commissions", {
          cursor: String(cursor),
          status: "pending",
          attempts: 0,
          lastError: null,
          state: {
            periodFrom, periodTo, pages, accumulator, coveragePct: pages > 0 ? 50 : 0, cycleStartedAt,
            ...(previous?.state.lastSyncedAt ? { lastSyncedAt: previous.state.lastSyncedAt } : {}),
          },
        });
        if (stateError) throw new Error(`состояние commissions: ${stateError}`);
        progress.push({ cabinet: cab.name, status: "pending", pages, pagesThisRun, cursor, coveragePct: pages > 0 ? 50 : 0 });
        continue;
      }

      const comm = commissionFromAccumulator(accumulator);
      if (!comm.byNm.size) {
        throw new Error("финотчёт не вернул ставки по SKU");
      }
      const synced_at = new Date().toISOString();
      const rows = [...comm.byNm.entries()].map(([nm_id, r]) => ({
        cabinet_id: cab.id, nm_id, pct: r.pct, acq_pct: r.acqPct, extra_pct: r.extraPct, rev: r.rev, synced_at,
        // Состав удержаний: null, если финотчёт по этому SKU его не дал, — колонки
        // nullable именно для того, чтобы «неизвестно» не превращалось в ноль.
        delivery_pct: r.parts?.delivery ?? null,
        storage_pct: r.parts?.storage ?? null,
        penalty_pct: r.parts?.penalty ?? null,
        acceptance_pct: r.parts?.acceptance ?? null,
        deduction_pct: r.parts?.deduction ?? null,
      }));
      const totalRev = rows.reduce((s, r) => s + r.rev, 0);

      const upsertErr = await chunkedUpsert("wb_nm_commissions", rows, "cabinet_id,nm_id");
      if (upsertErr) throw new Error(upsertErr);

      const { error: overheadError } = await db.from("wb_cabinet_commission_overhead").upsert(
        { cabinet_id: cab.id, overhead_pct: comm.overheadPct, rev: totalRev, synced_at },
        { onConflict: "cabinet_id" },
      );
      if (overheadError) throw new Error(overheadError.message);
      total += rows.length;
      const stateError = await writeWbSyncState(db, cab.id, "commissions", {
        cursor: null,
        status: "caught_up",
        attempts: 0,
        lastError: null,
        state: {
          periodFrom, periodTo, pages, coveragePct: 100, cycleStartedAt,
          lastSyncedAt: synced_at, completedAt: synced_at,
        },
      });
      if (stateError) throw new Error(`состояние commissions: ${stateError}`);
      progress.push({ cabinet: cab.name, status: "caught_up", pages, pagesThisRun, rows: rows.length, coveragePct: 100 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      errors.push(`${cab.name}: ${message}`);
      await writeWbSyncState(db, cab.id, "commissions", {
        cursor: String(cursor),
        status: "error",
        attempts: (previous?.attempts ?? 0) + 1,
        lastError: message,
        state: {
          periodFrom, periodTo, pages, accumulator, coveragePct: pages > 0 ? 50 : 0, cycleStartedAt,
          ...(previous?.state.lastSyncedAt ? { lastSyncedAt: previous.state.lastSyncedAt } : {}),
        },
      });
      progress.push({ cabinet: cab.name, status: "error", pages, pagesThisRun, cursor, error: message });
    }
  }

  const ok = errors.length === 0;
  await writeSyncLog("commissions", ok ? "ok" : "error", total, errors.join("; ") || null, startedAt);
  return NextResponse.json({ ok, rows: total, cabinets: cabs.length, availableCabinets: allCabs.length, errors, progress });
}
