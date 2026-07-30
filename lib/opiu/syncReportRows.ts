import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  fetchWbReportPage,
  type WbReportPageResult,
} from "@/lib/wb/reportPagination";
import type { WbReportRow } from "@/lib/wb/types";

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
  "bonusTypeName",
];

const UPSERT_CHUNK_SIZE = 1_000;
const MAX_REPORT_PAGES = 1_000;

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
  complete: true;
}

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

  let cursor = 0;
  let pages = 0;
  let synced = 0;

  for (let pageIndex = 0; pageIndex < MAX_REPORT_PAGES; pageIndex += 1) {
    const page: WbReportPageResult<WbReportRow> = await fetchWbReportPage<WbReportRow>({
      token,
      dateFrom,
      dateTo,
      initialRrdId: cursor,
      limit: 100_000,
      fields: REPORT_FIELDS,
    });
    if (page.complete) {
      return {
        synced,
        pages,
        lastRrdId: cursor,
        complete: true,
      };
    }

    const storedRows = page.rows.map((row) => reportRowForStorage(cabinetId, row));
    await upsertPage(storedRows);
    synced += storedRows.length;
    pages += 1;
    cursor = page.lastRrdId;
  }

  throw new Error(
    `WB financial report is incomplete after ${MAX_REPORT_PAGES} pages`,
  );
}
