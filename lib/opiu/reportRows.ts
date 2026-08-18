import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { WbReportRow } from "@/lib/wb/types";
import { OPIU_WB_CABINET_ID } from "./constants";

export type OpiuReportDateMode = "sale" | "report";

// cashback_discount (компенсация скидки по программе лояльности) читается наравне
// с остальными деньгами отчёта: колонка добавлена миграцией 202608200002, синк её
// запрашивает у WB и сохраняет, metrics.ts агрегирует в loyaltyCompensation.
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
  "cashback_discount",
  "bonus_type_name",
  "realizationreport_id",
  "rrd_id",
].join(",");

const FORECAST_REPORT_COLUMNS = [
  "rr_dt",
  "sale_dt",
  "sa_name",
  "doc_type_name",
  "supplier_oper_name",
  "quantity",
  "retail_price_withdisc_rub",
  "retail_amount",
  "ppvz_for_pay",
  "delivery_rub",
  "rebill_logistic_cost",
  "penalty",
  "deduction",
  "additional_payment",
  "storage_fee",
  "acceptance",
  "acquiring_fee",
  "realizationreport_id",
  "rrd_id",
].join(",");

const FORECAST_ARTICLE_BATCH_SIZE = 50;

function forecastArticleCandidates(articles: string[]) {
  const candidates = new Set<string>();
  for (const value of articles) {
    const article = String(value ?? "").trim();
    if (!article) continue;
    candidates.add(article);
    candidates.add(article.toUpperCase());
  }
  return [...candidates];
}

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

export async function fetchForecastReportRows(
  dateFrom: string,
  dateTo: string,
  articles: string[],
  signal?: AbortSignal,
  cabinetId: string = OPIU_WB_CABINET_ID,
): Promise<WbReportRow[]> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase service role is not configured");
  const candidates = forecastArticleCandidates(articles);
  if (candidates.length === 0) return [];

  const batches: string[][] = [];
  for (let index = 0; index < candidates.length; index += FORECAST_ARTICLE_BATCH_SIZE) {
    batches.push(candidates.slice(index, index + FORECAST_ARTICLE_BATCH_SIZE));
  }

  const rows = await Promise.all(batches.map((articleBatch) =>
    loadAllSupabasePages<WbReportRow>(async (from, to) => {
      const query = client
        .from("wb_report_rows")
        .select(FORECAST_REPORT_COLUMNS)
        .eq("cabinet_id", cabinetId)
        .not("sale_dt", "is", null)
        .gte("sale_dt", dateFrom)
        .lte("sale_dt", dateTo)
        .in("sa_name", articleBatch)
        .order("sale_dt", { ascending: true })
        .order("rrd_id", { ascending: true })
        .range(from, to);
      const result = signal ? await query.abortSignal(signal) : await query;
      return {
        data: result.data as unknown as WbReportRow[] | null,
        error: result.error ? { message: result.error.message } : null,
      };
    }, {
      maxPages: 300,
      label: "Прогноз выплат WB: финансовый отчёт по артикулам плана",
    }),
  ));

  return rows.flat();
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
