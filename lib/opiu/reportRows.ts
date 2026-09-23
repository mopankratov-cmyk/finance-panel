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
  "delivery_amount",
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

/**
 * articlePrefixes — фильтр по префиксу артикула ПРЯМО В SQL (ilike), а не
 * постфактум в JS: на обычных кабинетах разницы не видно, но на агентских
 * (Оптима — до ~116k строк отчёта/день, 92% из них чужие товары других
 * продавцов через тот же кабинет) запрос без этого фильтра тянет из
 * Postgres весь месяц целиком и стабильно падает по statement timeout —
 * ровно то, что нужному суб-бренду (Riobox/Heaton/Norvia) из этих строк
 * нужен один процент.
 */
export async function fetchReportRows(
  dateFrom: string,
  dateTo: string,
  mode: OpiuReportDateMode,
  cabinetId: string = OPIU_WB_CABINET_ID,
  articlePrefixes?: string[],
): Promise<WbReportRow[]> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase service role is not configured");
  const dateColumn = reportDateColumn(mode);
  const prefixFilter = articlePrefixes?.length
    ? articlePrefixes.map((p) => `sa_name.ilike.${p.replace(/[%,]/g, "")}%`).join(",")
    : null;

  return loadAllSupabasePages<WbReportRow>(async (from, to) => {
    let query = client
      .from("wb_report_rows")
      .select(REPORT_COLUMNS)
      .eq("cabinet_id", cabinetId)
      .not(dateColumn, "is", null)
      .gte(dateColumn, dateFrom)
      .lte(dateColumn, dateTo);
    if (prefixFilter) query = query.or(prefixFilter);
    const result = await query
      .order(dateColumn, { ascending: true })
      .order("rrd_id", { ascending: true })
      .range(from, to);
    return {
      data: result.data as unknown as WbReportRow[] | null,
      error: result.error ? { message: result.error.message } : null,
    };
  }, {
      maxPages: 1_000,
      // Агентские кабинеты (Оптима) даже под фильтром по префиксу артикула
      // отдают десятки страниц на одну неделю (38 страниц × ~780мс
      // последовательно — почти 30с только на сам запрос, до JS-обработки).
      // Постраничные запросы независимы (обычная OFFSET-пагинация над
      // готовым набором строк), параллелить их безопасно.
      concurrency: 8,
      label: mode === "sale"
        ? "ОПиУ: финансовый отчёт WB по дате продажи"
        : "ОПиУ: финансовый отчёт WB по дате отчёта",
    });
}

/**
 * Узкая выборка ТОЛЬКО строк "перевод на баланс заёмщика" (по всем 4
 * вариантам bonus_type_name, у них общий префикс) — нужна для
 * sharedLoanTransferByWeek, которой требуются НЕотфильтрованные по
 * артикулу строки всего кабинета (см. её комментарий), но полный
 * financial-отчёт агентского кабинета целиком гонять ради этого нельзя
 * (тот же statement timeout, что и в fetchReportRows). Фильтр по
 * bonus_type_name — в SQL, поэтому объём почти всегда крошечный
 * независимо от размера кабинета.
 */
export async function fetchLoanTransferRows(
  dateFrom: string,
  dateTo: string,
  mode: OpiuReportDateMode,
  cabinetId: string,
): Promise<WbReportRow[]> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase service role is not configured");
  const dateColumn = reportDateColumn(mode);

  return loadAllSupabasePages<WbReportRow>(async (from, to) => {
    const result = await client
      .from("wb_report_rows")
      .select(REPORT_COLUMNS)
      .eq("cabinet_id", cabinetId)
      .not(dateColumn, "is", null)
      .gte(dateColumn, dateFrom)
      .lte(dateColumn, dateTo)
      .ilike("bonus_type_name", "перевод на баланс заёмщика%")
      .order(dateColumn, { ascending: true })
      .order("rrd_id", { ascending: true })
      .range(from, to);
    return {
      data: result.data as unknown as WbReportRow[] | null,
      error: result.error ? { message: result.error.message } : null,
    };
  }, {
    maxPages: 100,
    concurrency: 8,
    label: "ОПиУ: перевод на баланс заёмщика",
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
