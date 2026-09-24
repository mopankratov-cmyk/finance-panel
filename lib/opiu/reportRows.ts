import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { WbReportRow } from "@/lib/wb/types";
import { OPIU_WB_CABINET_ID } from "./constants";

export type OpiuReportDateMode = "sale" | "report";

// cashback_discount (компенсация скидки по программе лояльности) читается наравне
// с остальными деньгами отчёта: колонка добавлена миграцией 202608200002, синк её
// запрашивает у WB и сохраняет, metrics.ts агрегирует в loyaltyCompensation.
const REPORT_COLUMN_NAMES = [
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
  "ppvz_vw",
  "ppvz_vw_nds",
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
];

const REPORT_COLUMNS = REPORT_COLUMN_NAMES.join(",");
const REPORT_COLUMNS_WITHOUT_DELIVERY_AMOUNT = REPORT_COLUMN_NAMES
  .filter((column) => column !== "delivery_amount")
  .join(",");

// Для сводного ОПиУ не нужны поля детальной маржинальности/прогноза. На
// Riobox за один месяц больше 120 тыс. строк, поэтому даже несколько лишних
// numeric-колонок заметно увеличивают JSON и время передачи из PostgREST.
// Полный набор остаётся значением по умолчанию для margin/forecast экранов.
const PNL_REPORT_COLUMNS = [
  "rr_dt",
  "sale_dt",
  "nm_id",
  "sa_name",
  "barcode",
  "doc_type_name",
  "supplier_oper_name",
  "quantity",
  "retail_price_withdisc_rub",
  "retail_amount",
  "ppvz_for_pay",
  "delivery_rub",
  "penalty",
  "deduction",
  "additional_payment",
  "storage_fee",
  "acceptance",
  "cashback_discount",
  "bonus_type_name",
  "rrd_id",
].join(",");

export function isMissingDeliveryAmountColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /delivery_amount/i.test(message)
    && /column|schema cache|could not find|does not exist/i.test(message);
}

async function withDeliveryAmountColumnFallback<T>(
  load: (columns: string) => Promise<T>,
): Promise<T> {
  try {
    return await load(REPORT_COLUMNS);
  } catch (error) {
    if (!isMissingDeliveryAmountColumnError(error)) throw error;
    console.warn("[opiu] wb_report_rows.delivery_amount is missing; loading the report without that optional metric");
    return load(REPORT_COLUMNS_WITHOUT_DELIVERY_AMOUNT);
  }
}

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
const REPORT_DATE_CONCURRENCY = 3;

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

export function reportDatesInRange(dateFrom: string, dateTo: string): string[] {
  const start = new Date(`${dateFrom}T00:00:00.000Z`);
  const end = new Date(`${dateTo}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return [];
  const dates: string[] = [];
  for (let current = start; current <= end; current = new Date(current.getTime() + 86_400_000)) {
    dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await map(values[index]!);
    }
  });
  await Promise.all(workers);
  return result;
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
  columnProfile: "full" | "pnl" = "full",
): Promise<WbReportRow[]> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase service role is not configured");
  const dateColumn = reportDateColumn(mode);
  const prefixFilter = articlePrefixes?.length
    ? articlePrefixes.map((p) => `sa_name.ilike.${p.replace(/[%,]/g, "")}%`).join(",")
    : null;

  const loadRows = (columns: string, exactDate?: string) =>
    loadAllSupabasePages<WbReportRow>(async (from, to) => {
        let query = client
          .from("wb_report_rows")
          .select(columns)
          .eq("cabinet_id", cabinetId)
          .not(dateColumn, "is", null);
        query = exactDate
          ? query.eq(dateColumn, exactDate)
          : query.gte(dateColumn, dateFrom).lte(dateColumn, dateTo);
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
        // В дневной выборке OFFSET остаётся маленьким; страницы одного дня идут
        // последовательно, а параллелизм задаётся между днями ниже.
        concurrency: exactDate ? 1 : 8,
        label: mode === "sale"
          ? "ОПиУ: финансовый отчёт WB по дате продажи"
          : "ОПиУ: финансовый отчёт WB по дате отчёта",
      });

  const loadSelectedColumns = async (columns: string) => {
    if (!prefixFilter) return loadRows(columns);
    // У агентского кабинета Оптима один бренд даёт более 100 тыс. строк за
    // месяц. Глубокий OFFSET по всему месяцу падает по statement timeout даже
    // при наличии trigram-индекса. Дневные диапазоны ограничивают OFFSET
    // несколькими тысячами строк и сохраняют полный финансовый факт.
    const dates = reportDatesInRange(dateFrom, dateTo);
    const byDate = await mapWithConcurrency(
      dates,
      REPORT_DATE_CONCURRENCY,
      (date) => loadRows(columns, date),
    );
    return byDate.flat();
  };

  if (columnProfile === "pnl") return loadSelectedColumns(PNL_REPORT_COLUMNS);
  return withDeliveryAmountColumnFallback(loadSelectedColumns);
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

  return withDeliveryAmountColumnFallback((columns) => loadAllSupabasePages<WbReportRow>(async (from, to) => {
    const result = await client
      .from("wb_report_rows")
      .select(columns)
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
  }));
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
