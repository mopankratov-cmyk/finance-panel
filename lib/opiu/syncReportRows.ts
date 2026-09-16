import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  fetchWbReportPage,
  type WbReportPageResult,
} from "@/lib/wb/reportPagination";
import type { WbReportRow } from "@/lib/wb/types";
import { claimWbSyncJob, readWbSyncState, writeWbSyncState } from "@/lib/wb/syncState";

const REPORT_FIELDS = [
  "rrdId",
  "reportId",
  "rrDate",
  "saleDt",
  "nmId",
  "vendorCode",
  "sku",
  "docTypeName",
  "sellerOperName",
  "quantity",
  "retailPrice",
  "retailPriceWithDisc",
  "retailAmount",
  "forPay",
  "ppvzSalesCommission",
  "deliveryService",
  "rebillLogisticCost",
  "penalty",
  "deduction",
  "additionalPayment",
  "paidStorage",
  "paidAcceptance",
  "acquiringFee",
  // Компенсация скидки по программе лояльности: WB отдаёт её только если
  // поле явно запрошено, иначе строка приходит без него и метрика ОПиУ = 0.
  "cashbackDiscount",
  "bonusTypeName",
];

const UPSERT_CHUNK_SIZE = 1_000;
const REPORT_SYNC_JOB = "opiu_report";
// Небольшие кабинеты (несколько страниц) должны по-прежнему полностью
// досинхроваться за один вызов, как раньше. Большие агентские кабинеты
// (см. Оптима — ~116k строк отчёта/день, разово падал по сети примерно на
// 7-й странице из-за объёма) не должны ни блокировать весь крон-запрос
// (maxDuration в app/api/opiu/monitor/route.ts), ни терять прогресс при
// обрыве: курсор пишется в wb_sync_state ПОСЛЕ каждой успешно скачанной
// страницы, поэтому следующий вызов (следующий тик крона) продолжает с
// последнего сохранённого rrd_id, а не с начала периода.
const MAX_PAGES_PER_CALL = 40;
const SOFT_TIME_BUDGET_MS = 240_000;

type StoredReportRow = Record<string, unknown> & {
  cabinet_id: string;
  rr_dt: string;
  rrd_id: number;
  updated_at: string;
};

function dateOnly(value: unknown): string | null {
  const date = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

export function reportRowForStorage(
  cabinetId: string,
  row: WbReportRow,
): StoredReportRow {
  const normalizedCabinetId = cabinetId.trim();
  if (!normalizedCabinetId) throw new Error("WB financial report row has no cabinet_id");

  const rrdId = safeInteger(row.rrd_id);
  if (rrdId === null || rrdId <= 0) {
    throw new Error("WB financial report row has invalid rrd_id");
  }
  const reportDate = dateOnly(row.rr_dt);
  if (!reportDate) throw new Error(`WB financial report row ${rrdId} has invalid rr_dt`);

  return {
    cabinet_id: normalizedCabinetId,
    rr_dt: reportDate,
    sale_dt: dateOnly(row.sale_dt),
    nm_id: safeInteger(row.nm_id),
    sa_name: text(row.sa_name),
    barcode: text(row.barcode),
    doc_type_name: text(row.doc_type_name),
    supplier_oper_name: text(row.supplier_oper_name),
    quantity: safeInteger(row.quantity),
    retail_price: finiteNumber(row.retail_price),
    retail_price_withdisc_rub: finiteNumber(row.retail_price_withdisc_rub),
    retail_amount: finiteNumber(row.retail_amount),
    ppvz_for_pay: finiteNumber(row.ppvz_for_pay),
    ppvz_sales_commission: finiteNumber(row.ppvz_sales_commission),
    delivery_rub: finiteNumber(row.delivery_rub),
    rebill_logistic_cost: finiteNumber(row.rebill_logistic_cost),
    penalty: finiteNumber(row.penalty),
    deduction: finiteNumber(row.deduction),
    additional_payment: finiteNumber(row.additional_payment),
    storage_fee: finiteNumber(row.storage_fee),
    acceptance: finiteNumber(row.acceptance),
    acquiring_fee: finiteNumber(row.acquiring_fee),
    cashback_discount: finiteNumber(row.cashback_discount),
    bonus_type_name: text(row.bonus_type_name),
    realizationreport_id: safeInteger(row.realizationreport_id),
    rrd_id: rrdId,
    updated_at: new Date().toISOString(),
  };
}

async function upsertPage(rows: StoredReportRow[]): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase service role is not configured");

  for (let start = 0; start < rows.length; start += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + UPSERT_CHUNK_SIZE);
    const { error } = await db
      .from("wb_report_rows")
      .upsert(chunk, { onConflict: "cabinet_id,rrd_id" });
    if (error) {
      throw new Error(`wb_report_rows upsert failed: ${error.message}`);
    }
  }
}

export interface SyncReportRowsResult {
  synced: number;
  pages: number;
  lastRrdId: number;
  /** false = период ещё не догружен целиком, продолжится на следующем вызове. */
  complete: boolean;
}

interface ReportSyncJobState extends Record<string, unknown> {
  periodDateFrom?: string;
  periodDateTo?: string;
  cursor?: number;
  synced?: number;
}

/**
 * Догружает "отчёт о реализации" WB за период, ОДИН вызов = ограниченная
 * порция работы (см. MAX_PAGES_PER_CALL/SOFT_TIME_BUDGET_MS), не весь период
 * сразу. Прогресс (курсор rrd_id + счётчик synced) хранится в wb_sync_state
 * по ключу (cabinetId, "opiu_report") и переживает обрыв/таймаут — повторный
 * вызов (следующий тик крона) продолжает с сохранённого курсора, а не
 * пересинкает период с нуля. dateFrom используется как признак "это тот же
 * период" — если он изменился (например, перевалило на новый месяц в
 * opiuReportRefreshPeriod), прогресс сбрасывается: старый курсор мог
 * относиться к окну, часть которого теперь вне периода.
 */
export async function syncReportRows(
  cabinetId: string,
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<SyncReportRowsResult> {
  if (!dateOnly(dateFrom) || !dateOnly(dateTo) || dateFrom > dateTo) {
    throw new Error("Invalid WB financial report period");
  }
  if (!token.trim()) throw new Error("WB finance token is not configured");

  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase service role is not configured");

  const saved = await readWbSyncState<ReportSyncJobState>(db, cabinetId, REPORT_SYNC_JOB);
  const sameWindow = saved?.state?.periodDateFrom === dateFrom;
  let cursor = sameWindow ? Number(saved?.state?.cursor ?? 0) || 0 : 0;
  let synced = sameWindow ? Number(saved?.state?.synced ?? 0) || 0 : 0;

  if (sameWindow && saved?.status === "complete" && saved.state?.periodDateTo === dateTo) {
    return { synced, pages: 0, lastRrdId: cursor, complete: true };
  }

  // Не даём двум параллельным вызовам (например, наложившимся тикам крона)
  // одновременно тянуть один и тот же кабинет — зависшая дольше 15 минут
  // блокировка считается протухшей и перехватывается следующим вызовом.
  const claimed = await claimWbSyncJob(db, cabinetId, REPORT_SYNC_JOB, 900);
  if (!claimed) {
    return { synced, pages: 0, lastRrdId: cursor, complete: false };
  }

  const persist = (status: string, lastError: string | null) =>
    writeWbSyncState<ReportSyncJobState>(db, cabinetId, REPORT_SYNC_JOB, {
      cursor: String(cursor),
      status,
      attempts: 0,
      lastError,
      state: { periodDateFrom: dateFrom, periodDateTo: dateTo, cursor, synced },
    });

  const startedAt = Date.now();
  let pages = 0;

  for (; pages < MAX_PAGES_PER_CALL; pages += 1) {
    let page: WbReportPageResult<WbReportRow>;
    try {
      page = await fetchWbReportPage<WbReportRow>({
        token,
        dateFrom,
        dateTo,
        initialRrdId: cursor,
        limit: 100_000,
        fields: REPORT_FIELDS,
      });
    } catch (error) {
      // Курсор в БД уже соответствует последней УСПЕШНО скачанной странице —
      // следующий вызов продолжит именно с него, а не с начала периода.
      await persist("error", error instanceof Error ? error.message : String(error));
      throw error;
    }

    if (page.complete) {
      await persist("complete", null);
      return { synced, pages, lastRrdId: cursor, complete: true };
    }

    const storedRows = page.rows.map((row) => reportRowForStorage(cabinetId, row));
    await upsertPage(storedRows);
    synced += storedRows.length;
    cursor = page.lastRrdId;
    await persist("running", null);

    if (Date.now() - startedAt > SOFT_TIME_BUDGET_MS) {
      return { synced, pages: pages + 1, lastRrdId: cursor, complete: false };
    }
  }

  return { synced, pages, lastRrdId: cursor, complete: false };
}
