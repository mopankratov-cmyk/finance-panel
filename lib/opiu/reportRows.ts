import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { WbReportRow } from "@/lib/wb/types";
import { OPIU_WB_CABINET_ID } from "./constants";

export type OpiuReportDateMode = "sale" | "report";

const REPORT_COLUMNS = [
  "rr_dt",
  "sale_dt",
  "nm_id",
  "sa_name",
  "barcode",
  "doc_type_name",
  "supplier_oper_name",
  "quantity",
  "retail_price",
  "retail_price_withdisc_rub",
  "retail_amount",
  "ppvz_for_pay",
  "ppvz_sales_commission",
  "delivery_rub",
  "rebill_logistic_cost",
  "penalty",
  "deduction",
  "additional_payment",
  "storage_fee",
  "acceptance",
  "acquiring_fee",
  "bonus_type_name",
  "realizationreport_id",
  "rrd_id",
].join(",");

function reportDateColumn(mode: OpiuReportDateMode): "sale_dt" | "rr_dt" {
  return mode === "sale" ? "sale_dt" : "rr_dt";
}

export async function fetchReportRows(
  dateFrom: string,
  dateTo: string,
  mode: OpiuReportDateMode,
): Promise<WbReportRow[]> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase service role is not configured");
  const dateColumn = reportDateColumn(mode);

  return loadAllSupabasePages<WbReportRow>(async (from, to) => {
    const result = await client
      .from("wb_report_rows")
      .select(REPORT_COLUMNS)
      .eq("cabinet_id", OPIU_WB_CABINET_ID)
      .not(dateColumn, "is", null)
      .gte(dateColumn, dateFrom)
      .lte(dateColumn, dateTo)
      .order(dateColumn, { ascending: true })
      .order("rrd_id", { ascending: true })
      .range(from, to);
    return {
      data: result.data as unknown as WbReportRow[] | null,
      error: result.error ? { message: result.error.message } : null,
    };
  }, {
      maxPages: 1_000,
      label: mode === "sale"
        ? "ОПиУ: финансовый отчёт WB по дате продажи"
        : "ОПиУ: финансовый отчёт WB по дате отчёта",
    });
}

function dateOnly(value: unknown): string | null {
  const date = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/**
 * aggregateWeek использует rr_dt как рабочую дату. Для первого свода подставляем
 * туда sale_dt в копии строки, не меняя сохранённый финансовый факт.
 */
export function rowsBySaleDate(rows: WbReportRow[]): WbReportRow[] {
  return rows.map((row) => ({
    ...row,
    rr_dt: dateOnly(row.sale_dt) ?? dateOnly(row.rr_dt) ?? undefined,
  }));
}
