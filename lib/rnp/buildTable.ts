import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  coverageForPeriod,
  currentMoscowDate,
  forecastAdditiveMetric,
  forecastRatioMetric,
  statusForCoverage,
  type RnpMetricForecast,
  type RnpMetricStatus,
} from "@/lib/rnp/forecast";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { getWbCommissionForCabinet, resolveWbRatesForNm } from "@/lib/wb/commissions";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";
import { loadRnpDailySkuRows, loadRnpReportRows } from "@/lib/rnp/rpcLoaders";

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

interface DailyRow {
  d: string;
  orders_count: number;
  orders_sum: number;
  buyouts_count: number;
  buyouts_sum: number;
  ad_spent: number;
}
interface SkuDailyRow extends DailyRow {
  nm_id: number;
}
interface RpcTotal {
  nm_id: number;
  article: string;
  stock: number;
  cost: number | null;
}
interface AdNmRow { nm_id: number; date: string; views: number | null; clicks: number | null }
interface FunnelRow {
  nm_id: number;
  date: string;
  open_card: number | null;
  add_to_cart: number | null;
  orders: number | null;
  orders_sum: number | null;
}
interface ProductCostRow { article: string; name: string | null; cost_rub?: number | null }
interface CabinetScope { cabinetId: string | null; label: string; allowedNmIds: Set<number> | null }
interface MetricCutoffs { orders: string | null; sales: string | null; adverts: string | null }
interface FunnelCutoffs { adverts: string | null; funnel: string | null }
type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

export interface ScopedOrderSourceRow {
  nm_id: number;
  supplier_article: string | null;
  date: string;
  total_price: number | null;
  discount_percent: number | null;
  is_cancel: boolean | null;
}

export interface ScopedSaleSourceRow {
  nm_id: number;
  date: string;
  price_with_disc: number | null;
  finished_price: number | null;
  sale_id: string | null;
}

export interface ScopedAdvertSpendRow {
  nm_id: number;
  date: string;
  spent: number | null;
}

export interface ScopedStockSourceRow {
  nm_id: number;
  quantity: number | null;
}

export interface ScopedProductSourceRow {
  nm_id: number;
  article: string | null;
}

interface PageResult<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

interface LoadAllPagesOptions {
  pageSize?: number;
  maxPages?: number;
  retries?: number;
}

/** PostgREST/Supabase returns at most 1,000 rows by default. */
export async function loadAllPages<Row>(
  loadPage: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  options: LoadAllPagesOptions = {},
): Promise<Row[]> {
  const pageSize = options.pageSize ?? 1_000;
  const maxPages = options.maxPages ?? 100;
  const retries = options.retries ?? 2;
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error("Некорректный размер страницы RNP");
  if (!Number.isInteger(maxPages) || maxPages <= 0) throw new Error("Некорректный лимит страниц RNP");

  const rows: Row[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    let result: PageResult<Row> | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      result = await loadPage(from, from + pageSize - 1);
      if (!result.error) break;
      const retryable = /fetch failed|statement timeout|timed out|timeout|connection/i.test(result.error.message);
      if (!retryable || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
    if (!result) throw new Error("RNP не получил ответ от базы данных");
    if (result.error) throw new Error(result.error.message);
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return rows;
  }
  throw new Error(`RNP превысил безопасный лимит ${pageSize * maxPages} строк`);
}

export function latestDate<Row>(rows: Row[], readDate: (row: Row) => unknown): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    const value = String(readDate(row) ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) && (!latest || value > latest)) latest = value;
  }
  return latest;
}

export function earliestKnownDate(values: Array<string | null | undefined>, fallback: string): string {
  const known = values.filter((value): value is string => !!value);
  return known.length ? known.reduce((earliest, value) => value < earliest ? value : earliest) : fallback;
}

export function applyRnpScopeCutoff<Row extends DailyRow>(rows: Row[], asOf: string): Row[] {
  return rows.map((row) => String(row.d).slice(0, 10) <= asOf ? row : ({
    ...row,
    orders_count: 0,
    orders_sum: 0,
    buyouts_count: 0,
    buyouts_sum: 0,
    ad_spent: 0,
  } as Row));
}

export function applyRnpSourceCutoffs<Row extends DailyRow>(
  rows: Row[],
  cutoffs: MetricCutoffs,
): Row[] {
  const isAfter = (date: string, cutoff: string | null) => !!cutoff && date > cutoff;
  return rows.map((row) => {
    const date = String(row.d).slice(0, 10);
    return {
      ...row,
      ...(isAfter(date, cutoffs.orders) ? { orders_count: 0, orders_sum: 0 } : {}),
      ...(isAfter(date, cutoffs.sales) ? { buyouts_count: 0, buyouts_sum: 0 } : {}),
      ...(isAfter(date, cutoffs.adverts) ? { ad_spent: 0 } : {}),
    };
  });
}

// Рекламные показы/клики/CTR и товарные переходы/корзины по SKU по дням — отдельные
// источники (wb_advert_nm_daily + wb_funnel_daily), не трогаем rnp_daily(_sku) RPC.
// Вклеивается в начало metrics[] построчно, тем же способом, что gross/margin_pct — сводкой.
export interface Metric {
  field: string;
  label: string;
  kind: string;
  daily: (number | null)[];
  total: number | null;
  forecast: number | null;
  forecastLow?: number | null;
  forecastHigh?: number | null;
  forecastConfidencePct?: number | null;
  forecastMethod?: string | null;
  coveragePct?: number;
  status?: RnpMetricStatus;
  source?: string;
  note?: string;
  qualityReason?: "no_activity" | "missing_cost" | "missing_rates" | "stale_source" | "api_error";
  group_start?: boolean;
}

const ADDITIVE_FORECAST_FIELDS = new Set([
  "views",
  "clicks",
  "open_card",
  "cart",
  "orders_count",
  "orders_sum",
  "buyouts_count",
  "buyouts_sum",
  "ad_spent",
  "gross",
]);

const RATIO_FORECAST_FIELDS: Record<string, { numerator: string; denominator: string }> = {
  ctr: { numerator: "clicks", denominator: "views" },
  buyout_pct: { numerator: "buyouts_count", denominator: "orders_count" },
  drr: { numerator: "ad_spent", denominator: "orders_sum" },
  margin_pct: { numerator: "gross", denominator: "buyouts_sum" },
};

function roundMetric(value: number, kind: string) {
  return kind === "pct" ? Math.round(value * 10) / 10 : Math.round(value);
}

function applyForecast(metric: Metric, result: RnpMetricForecast | null, days: string[], asOf: string) {
  const coveragePct = result?.coveragePct ?? coverageForPeriod(days, metric.daily, asOf);
  metric.coveragePct = coveragePct;
  metric.status = statusForCoverage(coveragePct);
  metric.forecast = result ? roundMetric(result.value, metric.kind) : null;
  metric.forecastLow = result ? roundMetric(result.low, metric.kind) : null;
  metric.forecastHigh = result ? roundMetric(result.high, metric.kind) : null;
  metric.forecastConfidencePct = result?.confidencePct ?? null;
  metric.forecastMethod = result?.method ?? null;
}

type MetricAsOfMap = Partial<Record<string, string>>;

function cutoffAsOf(cutoff: string | null, fallback: string) {
  return cutoff && cutoff < fallback ? cutoff : fallback;
}

function applyMetricForecasts(metrics: Metric[], days: string[], asOf: string, metricAsOf: MetricAsOfMap = {}) {
  const results = new Map<string, RnpMetricForecast | null>();
  for (const metric of metrics) {
    if (!ADDITIVE_FORECAST_FIELDS.has(metric.field)) continue;
    const sourceAsOf = metricAsOf[metric.field] ?? asOf;
    const result = forecastAdditiveMetric(days, metric.daily, sourceAsOf);
    results.set(metric.field, result);
    applyForecast(metric, result, days, sourceAsOf);
  }
  for (const metric of metrics) {
    const ratio = RATIO_FORECAST_FIELDS[metric.field];
    if (!ratio) continue;
    const result = forecastRatioMetric(results.get(ratio.numerator) ?? null, results.get(ratio.denominator) ?? null);
    results.set(metric.field, result);
    applyForecast(metric, result, days, asOf);
  }
  for (const metric of metrics) {
    if (ADDITIVE_FORECAST_FIELDS.has(metric.field) || RATIO_FORECAST_FIELDS[metric.field]) continue;
    metric.coveragePct = metric.total == null ? 0 : 100;
    metric.status = metric.total == null ? "unavailable" : "ready";
    metric.forecast = null;
    metric.forecastLow = null;
    metric.forecastHigh = null;
    metric.forecastConfidencePct = null;
    metric.forecastMethod = null;
  }
  for (const metric of metrics) {
    if (metric.qualityReason) continue;
    if ((metric.coveragePct ?? 0) < 100) metric.qualityReason = "stale_source";
    else if (metric.total == null) metric.qualityReason = "no_activity";
  }
  return metrics;
}

export function applyEconomyMetricCoverage(
  metric: Metric,
  economyCoveragePct: number,
  note: string,
  qualityReason: Metric["qualityReason"] = "missing_cost",
) {
  const sourceCoverage = metric.field === "gmroi" && metric.total != null
    ? 100
    : (metric.coveragePct ?? (metric.total == null ? 0 : 100));
  metric.coveragePct = metric.total == null ? 0 : Math.min(sourceCoverage, economyCoveragePct);
  metric.status = statusForCoverage(metric.coveragePct);
  metric.qualityReason = economyCoveragePct < 100 ? qualityReason : metric.qualityReason;
  metric.note = [metric.note, note].filter(Boolean).join(" ");
  if (metric.forecastConfidencePct != null) {
    metric.forecastConfidencePct = Math.min(metric.forecastConfidencePct, Math.round(economyCoveragePct));
  }
}

function knownSum(values: (number | null)[]) {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

/**
 * Остатки WB — текущий снимок, а не исторический ряд. Показываем известный KPI
 * только в колонке даты факта, чтобы РНП не оставлял актуальную ячейку пустой и
 * при этом не выдавал сегодняшний остаток за остаток прошлых дней.
 */
export function pointInTimeMetricDaily(
  days: string[],
  asOf: string,
  value: number | null,
): (number | null)[] {
  return days.map((day) => day === asOf && value != null && Number.isFinite(value) ? value : null);
}

export function buildFunnelMetrics(
  days: string[],
  asOf: string,
  viewsByDate: Map<string, number>,
  clicksByDate: Map<string, number>,
  openCardByDate: Map<string, number>,
  cartByDate: Map<string, number>,
  cutoffs: FunnelCutoffs,
): Metric[] {
  const read = (source: Map<string, number>, day: string, cutoff: string | null) =>
    !cutoff || day > asOf || day > cutoff || !source.has(day) ? null : Number(source.get(day));
  const views = days.map((day) => read(viewsByDate, day, cutoffs.adverts));
  const clicks = days.map((day) => read(clicksByDate, day, cutoffs.adverts));
  const openCard = days.map((day) => read(openCardByDate, day, cutoffs.funnel));
  const cart = days.map((day) => read(cartByDate, day, cutoffs.funnel));
  const ctr = days.map((_, index) => Number(views[index]) > 0 && clicks[index] != null
    ? Math.round((Number(clicks[index]) / Number(views[index])) * 1000) / 10
    : null);
  const totalViews = knownSum(views);
  const totalClicks = knownSum(clicks);
  const metrics: Metric[] = [
    { field: "views", label: "Рекламные показы", kind: "int", daily: views, total: totalViews, forecast: null, source: "WB Реклама", group_start: true },
    { field: "clicks", label: "Рекламные клики", kind: "int", daily: clicks, total: totalClicks, forecast: null, source: "WB Реклама" },
    { field: "ctr", label: "Рекламный CTR, %", kind: "pct", daily: ctr, total: totalViews && totalClicks != null ? Math.round((totalClicks / totalViews) * 1000) / 10 : null, forecast: null, source: "WB Реклама", note: "Рекламные клики / рекламные показы. Пустые даты источника не считаются нулём." },
    { field: "open_card", label: "Переходы в карточку", kind: "int", daily: openCard, total: knownSum(openCard), forecast: null, source: "WB Воронка", group_start: true },
    { field: "cart", label: "В корзину", kind: "int", daily: cart, total: knownSum(cart), forecast: null, source: "WB Воронка" },
  ];
  return applyMetricForecasts(metrics, days, asOf, {
    views: cutoffAsOf(cutoffs.adverts, asOf),
    clicks: cutoffAsOf(cutoffs.adverts, asOf),
    open_card: cutoffAsOf(cutoffs.funnel, asOf),
    cart: cutoffAsOf(cutoffs.funnel, asOf),
  });
}

// cost > 0 → добавляем прибыль и маржу после расходов МП. Для сводки эти метрики вклеиваются агрегатом по SKU.
function buildMetrics(
  days: string[],
  asOf: string,
  byDate: Map<string, DailyRow>,
  stock: number,
  stockMoney: number,
  cutoffs: MetricCutoffs,
  cost = 0,
  wbCostPct: number | null = null,
): Metric[] {
  const pick = (key: keyof DailyRow, cutoff: string | null) => days.map((day) =>
    !cutoff || day > asOf || day > cutoff ? null : Number(byDate.get(day)?.[key] ?? 0));
  const r1 = (value: number) => Math.round(value * 10) / 10;
  const ordersCount = pick("orders_count", cutoffs.orders);
  const ordersSum = pick("orders_sum", cutoffs.orders);
  const buyoutsCount = pick("buyouts_count", cutoffs.sales);
  const buyoutsSum = pick("buyouts_sum", cutoffs.sales);
  const adSpend = pick("ad_spent", cutoffs.adverts);
  const drr = days.map((_, index) => ordersSum[index] != null && adSpend[index] != null && ordersSum[index] > 0
    ? r1((adSpend[index] / ordersSum[index]) * 100)
    : null);
  const buyoutPct = days.map((_, index) => ordersCount[index] != null && buyoutsCount[index] != null && ordersCount[index] > 0
    ? r1((buyoutsCount[index] / ordersCount[index]) * 100)
    : null);
  const totalOrdersSum = knownSum(ordersSum);
  const totalBuyoutsCount = knownSum(buyoutsCount);
  const totalOrdersCount = knownSum(ordersCount);
  const totalBuyoutsSum = knownSum(buyoutsSum);
  const totalAdSpend = knownSum(adSpend);
  const out: Metric[] = [
    { field: "orders_count", label: "Заказы, шт", kind: "int", daily: ordersCount, total: totalOrdersCount, forecast: null, source: "WB Воронка/Статистика", note: "WB Analytics → Этапы воронки продаж; WB Статистика используется как fallback, если воронка ещё не загрузилась.", group_start: true },
    { field: "orders_sum", label: "Заказы, ₽", kind: "money", daily: ordersSum, total: totalOrdersSum == null ? null : Math.round(totalOrdersSum), forecast: null, source: "WB Воронка/Статистика", note: "WB Analytics → Этапы воронки продаж; WB Статистика используется как fallback, если воронка ещё не загрузилась." },
    { field: "buyouts_count", label: "Выкупы, шт", kind: "int", daily: buyoutsCount, total: totalBuyoutsCount, forecast: null, source: "WB Статистика", group_start: true },
    { field: "buyouts_sum", label: "Выкупы, ₽", kind: "money", daily: buyoutsSum, total: totalBuyoutsSum == null ? null : Math.round(totalBuyoutsSum), forecast: null, source: "WB Статистика" },
    {
      field: "buyout_pct",
      label: "Выкуп потока, %",
      kind: "pct",
      daily: buyoutPct,
      total: totalOrdersCount != null && totalBuyoutsCount != null && totalOrdersCount > 0 ? r1((totalBuyoutsCount / totalOrdersCount) * 100) : null,
      forecast: null,
      source: "WB Воронка + WB Статистика",
      note: "Календарные заказы и выкупы относятся к разным когортам, поэтому дневное значение может превышать 100%.",
    },
    { field: "ad_spent", label: "Реклама, ₽", kind: "money", daily: adSpend, total: totalAdSpend == null ? null : Math.round(totalAdSpend), forecast: null, source: "WB Реклама", group_start: true },
    { field: "drr", label: "ДРР к заказам, %", kind: "pct", daily: drr, total: totalOrdersSum != null && totalAdSpend != null && totalOrdersSum > 0 ? r1((totalAdSpend / totalOrdersSum) * 100) : null, forecast: null, source: "WB Реклама + WB Воронка/Статистика", note: "Рекламный расход / сумма заказов календарного периода." },
  ];
  let grossTotalForGmroi: number | null = null;
  if (cost > 0 && wbCostPct != null) {
    // Маржа после ВСЕХ расходов МП: выкупы₽ − себес×выкупы − wbCost%(комиссия+эквайринг+логистика+
    // хранение+штрафы+приёмка+прочие) − реклама. Всё из ФАКТ-финотчёта. Маржа % = это / выкупы₽.
    const marketplaceCost = wbCostPct / 100;
    const gross = days.map((_, index) =>
      buyoutsSum[index] == null || buyoutsCount[index] == null || adSpend[index] == null
        ? null
        : Math.round(
          buyoutsSum[index]
          - cost * buyoutsCount[index]
          - buyoutsSum[index] * marketplaceCost
          - adSpend[index],
        ));
    const totalGross = knownSum(gross);
    const grossBuyoutsSum = knownSum(buyoutsSum.map((value, index) => gross[index] == null ? null : value));
    grossTotalForGmroi = totalGross;
    const marginPct = days.map((_, index) => buyoutsSum[index] != null && buyoutsSum[index] > 0 && gross[index] != null
      ? r1((gross[index] / buyoutsSum[index]) * 100)
      : null);
    out.push(
      { field: "gross", label: "Прибыль после расходов МП, ₽", kind: "money", daily: gross, total: totalGross == null ? null : Math.round(totalGross), forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама", group_start: true },
      { field: "margin_pct", label: "Расчётная маржа после рекламы, %", kind: "pct", daily: marginPct, total: grossBuyoutsSum != null && totalGross != null && grossBuyoutsSum > 0 ? r1((totalGross / grossBuyoutsSum) * 100) : null, forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама" },
    );
  } else {
    const qualityReason: Metric["qualityReason"] = cost <= 0 ? "missing_cost" : "missing_rates";
    out.push(
      { field: "gross", label: "Прибыль после расходов МП, ₽", kind: "money", daily: days.map(() => null), total: null, forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама", qualityReason, group_start: true },
      { field: "margin_pct", label: "Расчётная маржа после рекламы, %", kind: "pct", daily: days.map(() => null), total: null, forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама", qualityReason },
    );
  }
  // Оборачиваемость, дней = остаток / (выкупы в день). GMROI % = валовая / деньги в остатках.
  const observedDays = buyoutsCount.filter((value) => value != null).length;
  const dailyBuyouts = observedDays > 0 && totalBuyoutsCount != null ? totalBuyoutsCount / observedDays : 0;
  const turnover = dailyBuyouts > 0 ? Math.round(stock / dailyBuyouts) : null;
  const gmroi = grossTotalForGmroi != null && stockMoney > 0 ? r1(Math.min(999, (grossTotalForGmroi / stockMoney) * 100)) : null;
  const knownStockMoney = stockMoney > 0 || stock === 0 ? Math.round(stockMoney) : null;
  const snapshotNote = "Текущий снимок показан в дате факта; прошлые дни не подменяются сегодняшним остатком.";
  out.push(
    { field: "stock", label: "Остаток, шт", kind: "int", daily: pointInTimeMetricDaily(days, asOf, stock), total: stock, forecast: null, source: "WB Остатки", note: snapshotNote, group_start: true },
    { field: "money", label: "Деньги в остатках, ₽", kind: "money", daily: pointInTimeMetricDaily(days, asOf, knownStockMoney), total: knownStockMoney, forecast: null, source: "WB Остатки + себестоимость", note: snapshotNote, qualityReason: knownStockMoney == null && stock > 0 ? "missing_cost" : undefined },
    { field: "turnover", label: "Оборачиваемость, дней", kind: "int", daily: pointInTimeMetricDaily(days, asOf, turnover), total: turnover, forecast: null, source: "WB Остатки + выкупы", note: snapshotNote, qualityReason: turnover == null ? "no_activity" : undefined },
    { field: "gmroi", label: "GMROI, %", kind: "pct", daily: pointInTimeMetricDaily(days, asOf, gmroi), total: gmroi, forecast: null, source: "Расчётная прибыль / деньги в остатках", note: snapshotNote, qualityReason: cost <= 0 && stock > 0 ? "missing_cost" : wbCostPct == null ? "missing_rates" : gmroi == null ? "no_activity" : undefined },
  );
  return applyMetricForecasts(out, days, asOf, {
    orders_count: cutoffAsOf(cutoffs.orders, asOf),
    orders_sum: cutoffAsOf(cutoffs.orders, asOf),
    buyouts_count: cutoffAsOf(cutoffs.sales, asOf),
    buyouts_sum: cutoffAsOf(cutoffs.sales, asOf),
    ad_spent: cutoffAsOf(cutoffs.adverts, asOf),
    gross: cutoffAsOf(earliestKnownDate([cutoffs.sales, cutoffs.adverts], asOf), asOf),
  });
}

export interface RnpTable {
  shop_label: string;
  sku_count: number;
  generated_at: string;
  as_of: string;
  scope_freshness: Array<{
    cabinet_id: string | null;
    label: string;
    as_of: string;
    orders_as_of: string | null;
    sales_as_of: string | null;
  }>;
  forecast_note: string;
  period: { label: string; period_type: string }[];
  summary: Metric[];
  skus: { nm: number; art: string; name: string; img_url: string; metrics: Metric[] }[];
}

function nextIsoDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function latestKnownDate(values: Array<string | null | undefined>): string | null {
  const known = values.filter((value): value is string => !!value);
  return known.length ? known.reduce((latest, value) => value > latest ? value : latest) : null;
}

function scopedDailyKey(nmId: number, date: string) {
  return `${nmId}:${date}`;
}

function readDate(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

export function applyFunnelOrdersOverlay(rows: SkuDailyRow[], funnelRows: FunnelRow[]): SkuDailyRow[] {
  const dailyRows = new Map<string, SkuDailyRow>();
  for (const row of rows) {
    const nmId = Number(row.nm_id);
    const date = readDate(row.d);
    if (!Number.isFinite(nmId) || !date) continue;
    dailyRows.set(scopedDailyKey(nmId, date), {
      d: date,
      nm_id: nmId,
      orders_count: Number(row.orders_count ?? 0),
      orders_sum: Number(row.orders_sum ?? 0),
      buyouts_count: Number(row.buyouts_count ?? 0),
      buyouts_sum: Number(row.buyouts_sum ?? 0),
      ad_spent: Number(row.ad_spent ?? 0),
    });
  }

  const funnelOrders = new Map<string, {
    nmId: number;
    date: string;
    orders_count: number;
    orders_sum: number;
    hasOrdersCount: boolean;
    hasOrdersSum: boolean;
  }>();
  for (const row of funnelRows) {
    const nmId = Number(row.nm_id);
    const date = readDate(row.date);
    if (!Number.isFinite(nmId) || !date) continue;
    const key = scopedDailyKey(nmId, date);
    const current = funnelOrders.get(key) ?? {
      nmId,
      date,
      orders_count: 0,
      orders_sum: 0,
      hasOrdersCount: false,
      hasOrdersSum: false,
    };
    if (row.orders != null && Number.isFinite(Number(row.orders))) {
      current.orders_count += Number(row.orders);
      current.hasOrdersCount = true;
    }
    if (row.orders_sum != null && Number.isFinite(Number(row.orders_sum))) {
      current.orders_sum += Number(row.orders_sum);
      current.hasOrdersSum = true;
    }
    funnelOrders.set(key, current);
  }

  for (const [key, overlay] of funnelOrders) {
    if (!overlay.hasOrdersCount && !overlay.hasOrdersSum) continue;
    const current = dailyRows.get(key) ?? {
      d: overlay.date,
      nm_id: overlay.nmId,
      orders_count: 0,
      orders_sum: 0,
      buyouts_count: 0,
      buyouts_sum: 0,
      ad_spent: 0,
    };
    dailyRows.set(key, {
      ...current,
      orders_count: overlay.hasOrdersCount ? overlay.orders_count : current.orders_count,
      orders_sum: overlay.hasOrdersSum ? overlay.orders_sum : current.orders_sum,
    });
  }

  return [...dailyRows.values()].sort((a, b) => a.d.localeCompare(b.d) || a.nm_id - b.nm_id);
}

function touchScopedDailyRow(rows: Map<string, SkuDailyRow>, nmId: number, date: string) {
  const key = scopedDailyKey(nmId, date);
  const current = rows.get(key) ?? {
    d: date,
    nm_id: nmId,
    orders_count: 0,
    orders_sum: 0,
    buyouts_count: 0,
    buyouts_sum: 0,
    ad_spent: 0,
  };
  rows.set(key, current);
  return current;
}

function writeArticle(articleByNm: Map<number, string>, nmId: number, article: string | null | undefined) {
  const clean = String(article ?? "").trim();
  if (clean && !articleByNm.get(nmId)) articleByNm.set(nmId, clean);
}

export function buildScopedBaseFactsFromRows(input: {
  allowedNmIds: number[];
  orders: ScopedOrderSourceRow[];
  sales: ScopedSaleSourceRow[];
  advertSpend: ScopedAdvertSpendRow[];
  stocks: ScopedStockSourceRow[];
  products: ScopedProductSourceRow[];
  costs: ProductCostRow[];
}): { skuRows: SkuDailyRow[]; totals: RpcTotal[] } {
  const allowed = new Set(input.allowedNmIds);
  const dailyRows = new Map<string, SkuDailyRow>();
  const articleByNm = new Map<number, string>();
  const stockByNm = new Map<number, number>();
  const costByArticle = new Map<string, number | null>();

  for (const product of input.products) {
    if (!allowed.has(Number(product.nm_id))) continue;
    writeArticle(articleByNm, Number(product.nm_id), product.article);
  }
  for (const cost of input.costs) {
    const article = String(cost.article ?? "").trim();
    if (article) costByArticle.set(article, cost.cost_rub == null ? null : Number(cost.cost_rub));
  }
  for (const order of input.orders) {
    const nmId = Number(order.nm_id);
    if (!allowed.has(nmId) || order.is_cancel === true) continue;
    const date = readDate(order.date);
    if (!date) continue;
    writeArticle(articleByNm, nmId, order.supplier_article);
    const row = touchScopedDailyRow(dailyRows, nmId, date);
    row.orders_count += 1;
    row.orders_sum += Number(order.total_price ?? 0) * (1 - Number(order.discount_percent ?? 0) / 100);
  }
  for (const sale of input.sales) {
    const nmId = Number(sale.nm_id);
    if (!allowed.has(nmId) || !String(sale.sale_id ?? "").startsWith("S")) continue;
    const date = readDate(sale.date);
    if (!date) continue;
    const row = touchScopedDailyRow(dailyRows, nmId, date);
    row.buyouts_count += 1;
    row.buyouts_sum += Number(sale.price_with_disc ?? sale.finished_price ?? 0);
  }
  for (const advert of input.advertSpend) {
    const nmId = Number(advert.nm_id);
    if (!allowed.has(nmId)) continue;
    const date = readDate(advert.date);
    if (!date) continue;
    const row = touchScopedDailyRow(dailyRows, nmId, date);
    row.ad_spent += Number(advert.spent ?? 0);
  }
  for (const stock of input.stocks) {
    const nmId = Number(stock.nm_id);
    if (!allowed.has(nmId)) continue;
    stockByNm.set(nmId, (stockByNm.get(nmId) ?? 0) + Number(stock.quantity ?? 0));
  }

  const totals = input.allowedNmIds.map((nmId) => {
    const article = articleByNm.get(nmId) ?? "";
    return {
      nm_id: nmId,
      article,
      stock: stockByNm.get(nmId) ?? 0,
      cost: article ? (costByArticle.get(article) ?? null) : null,
    };
  });

  return {
    skuRows: [...dailyRows.values()].sort((a, b) => a.d.localeCompare(b.d) || a.nm_id - b.nm_id),
    totals,
  };
}

async function loadScopedBaseFacts(
  db: SupabaseAdmin,
  scope: CabinetScope,
  allowed: number[],
  from: string,
  to: string,
) {
  const dateFrom = `${from}T00:00:00.000Z`;
  const dateTo = `${nextIsoDate(to)}T00:00:00.000Z`;
  const [orders, sales, advertSpend, stocks, products] = await Promise.all([
    loadAllPages<ScopedOrderSourceRow>((start, end) => {
      let query = db
        .from("wb_orders")
        .select("nm_id, supplier_article, date, total_price, discount_percent, is_cancel")
        .gte("date", dateFrom)
        .lt("date", dateTo)
        .in("nm_id", allowed)
        .order("date", { ascending: true })
        .order("nm_id", { ascending: true })
        .range(start, end);
      if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
      return query;
    }),
    loadAllPages<ScopedSaleSourceRow>((start, end) => {
      let query = db
        .from("wb_sales")
        .select("nm_id, date, price_with_disc, finished_price, sale_id")
        .gte("date", dateFrom)
        .lt("date", dateTo)
        .in("nm_id", allowed)
        .like("sale_id", "S%")
        .order("date", { ascending: true })
        .order("nm_id", { ascending: true })
        .range(start, end);
      if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
      return query;
    }),
    loadAllPages<ScopedAdvertSpendRow>((start, end) => {
      let query = db
        .from("wb_advert_nm_daily")
        .select("nm_id, date, spent")
        .gte("date", from)
        .lte("date", to)
        .in("nm_id", allowed)
        .order("date", { ascending: true })
        .order("nm_id", { ascending: true })
        .range(start, end);
      if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
      return query;
    }),
    loadAllPages<ScopedStockSourceRow>((start, end) => {
      let query = db
        .from("wb_stocks")
        .select("nm_id, quantity")
        .in("nm_id", allowed)
        .order("nm_id", { ascending: true })
        .range(start, end);
      if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
      return query;
    }),
    loadAllPages<ScopedProductSourceRow>((start, end) => {
      let query = db
        .from("wb_cabinet_product_scope")
        .select("nm_id, article")
        .in("nm_id", allowed)
        .order("nm_id", { ascending: true })
        .range(start, end);
      if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
      return query;
    }),
  ]);
  const articleSet = new Set<string>();
  for (const product of products) if (product.article) articleSet.add(product.article);
  for (const order of orders) if (order.supplier_article) articleSet.add(order.supplier_article);
  const articles = [...articleSet];
  const costs = articles.length
    ? await loadAllPages<ProductCostRow>((start, end) => db
      .from("product_costs")
      .select("article, name, cost_rub")
      .in("article", articles)
      .order("article", { ascending: true })
      .range(start, end))
    : [];

  return buildScopedBaseFactsFromRows({ allowedNmIds: allowed, orders, sales, advertSpend, stocks, products, costs });
}

export async function buildRnpTable(from: string, to: string, cabinetId?: string | null, shopLabel?: string): Promise<RnpTable | { error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { error: "Supabase не настроен" };

  const p_cabinet = cabinetId || null; // null = все кабинеты
  const activeCabinets = await getActiveWbCabinets();
  let scopes: CabinetScope[];
  if (activeCabinets.length) {
    const selected = p_cabinet
      ? activeCabinets.filter((cabinet) => cabinet.id === p_cabinet)
      : activeCabinets;
    if (!selected.length) return { error: "Активный кабинет WB не найден" };
    scopes = selected.map((cabinet) => ({
      cabinetId: cabinet.id,
      label: cabinet.name,
      // [] — намеренно закрытый scope: при ошибке allowlist Optima не становится unrestricted.
      allowedNmIds: cabinet.allowed_nm_ids === null ? null : new Set(cabinet.allowed_nm_ids),
    }));
  } else {
    // getActiveWbCabinets исторически возвращает [] и при ошибке чтения. Проверяем
    // наличие кабинетов отдельно, чтобы сбой БД не открыл общий unrestricted-режим.
    const probe = await db
      .from("wb_cabinets")
      .select("id", { count: "exact", head: true })
      .eq("marketplace", "wb")
      .eq("is_active", true);
    if (probe.error) return { error: probe.error.message };
    if ((probe.count ?? 0) > 0) return { error: "Не удалось безопасно прочитать кабинеты WB" };
    scopes = [{ cabinetId: p_cabinet, label: shopLabel || "Магазин", allowedNmIds: await requestAllowedNmIds(p_cabinet) }];
  }

  const latestSourceDate = async (table: "wb_orders" | "wb_sales", scope: CabinetScope) => {
    if (scope.allowedNmIds?.size === 0) return null;
    let query = db
      .from(table)
      .select("date")
      .gte("date", `${from}T00:00:00.000Z`)
      .lt("date", `${nextIsoDate(to)}T00:00:00.000Z`)
      .order("date", { ascending: false })
      .limit(1);
    if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
    if (scope.allowedNmIds) query = query.in("nm_id", [...scope.allowedNmIds]);
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    return result.data?.[0]?.date ? String(result.data[0].date).slice(0, 10) : null;
  };

  try {
    const periodEnd = to < currentMoscowDate() ? to : currentMoscowDate();
    const [scopeData, costs, comm] = await Promise.all([
      Promise.all(scopes.map(async (scope) => {
        if (scope.allowedNmIds?.size === 0) {
          return {
            skuRows: [] as SkuDailyRow[],
            totals: [] as RpcTotal[],
            adRows: [] as AdNmRow[],
            funnelRows: [] as FunnelRow[],
            ordersCutoff: null as string | null,
            salesCutoff: null as string | null,
            advertsCutoff: null as string | null,
            funnelCutoff: null as string | null,
            scope,
            asOf: periodEnd,
          };
        }
        const allowed = scope.allowedNmIds ? [...scope.allowedNmIds] : null;
        const [baseFacts, adRows, funnelRows, ordersCutoff, salesCutoff] = await Promise.all([
          allowed
            ? loadScopedBaseFacts(db, scope, allowed, from, to)
            : Promise.all([
              loadRnpDailySkuRows<SkuDailyRow>(db, {
                from,
                to,
                cabinetId: scope.cabinetId,
                label: `${scope.label}: RNP по дням`,
              }),
              loadRnpReportRows<RpcTotal>(db, scope.cabinetId, { label: `${scope.label}: RNP товары` }),
            ]).then(([skuRows, totals]) => ({ skuRows, totals })),
          loadAllPages<AdNmRow>((start, end) => {
            let query = db
              .from("wb_advert_nm_daily")
              .select("nm_id, date, views, clicks")
              .gte("date", from)
              .lte("date", to)
              .order("date", { ascending: true })
              .order("nm_id", { ascending: true })
              .range(start, end);
            if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
            if (allowed) query = query.in("nm_id", allowed);
            return query;
          }),
          loadAllPages<FunnelRow>((start, end) => {
            let query = db
              .from("wb_funnel_daily")
              .select("nm_id, date, open_card, add_to_cart, orders, orders_sum")
              .gte("date", from)
              .lte("date", to)
              .order("date", { ascending: true })
              .order("nm_id", { ascending: true })
              .range(start, end);
            if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
            if (allowed) query = query.in("nm_id", allowed);
            return query;
          }),
          latestSourceDate("wb_orders", scope),
          latestSourceDate("wb_sales", scope),
        ]);
        const advertsCutoff = latestDate(adRows, (row) => row.date);
        const funnelCutoff = latestDate(funnelRows, (row) => row.date);
        return {
          skuRows: baseFacts.skuRows,
          totals: baseFacts.totals,
          adRows,
          funnelRows,
          ordersCutoff,
          salesCutoff,
          advertsCutoff,
          funnelCutoff,
          scope,
          asOf: earliestKnownDate([latestKnownDate([funnelCutoff, ordersCutoff]), salesCutoff], periodEnd),
        };
      })),
      loadAllPages<ProductCostRow>((start, end) => db
        .from("product_costs")
        .select("article, name, cost_rub")
        .order("article", { ascending: true })
        .range(start, end)),
      getWbCommissionForCabinet(p_cabinet, 30, { allowLiveFallback: false }),
    ]);

    const skuDailyRows = scopeData.flatMap((item) => applyRnpSourceCutoffs(
      applyFunnelOrdersOverlay(item.skuRows, item.funnelRows),
      {
        orders: latestKnownDate([item.funnelCutoff, item.ordersCutoff]),
        sales: item.salesCutoff,
        adverts: item.advertsCutoff,
      },
    ));
    const totals = scopeData.flatMap((item) => item.totals);
    const adRows = scopeData.flatMap((item) => item.adRows.filter((row) => !item.advertsCutoff || String(row.date).slice(0, 10) <= item.advertsCutoff));
    const funnelRows = scopeData.flatMap((item) => item.funnelRows.filter((row) => !item.funnelCutoff || String(row.date).slice(0, 10) <= item.funnelCutoff));
    // У каждого источника своя свежесть. Раньше весь РНП обрезался по min(orders, sales),
    // из-за чего задержка выкупов могла занижать уже загруженные заказы Optima.
    const ordersCutoff = latestKnownDate(scopeData.map((item) => latestKnownDate([item.funnelCutoff, item.ordersCutoff])));
    const salesCutoff = latestKnownDate(scopeData.map((item) => item.salesCutoff));
    const advertsCutoff = latestKnownDate(scopeData.map((item) => item.advertsCutoff));
    const funnelCutoff = latestKnownDate(scopeData.map((item) => item.funnelCutoff));
    const cutoffsByNm = new Map<number, MetricCutoffs>();
    for (const item of scopeData) {
      const cutoffs = { orders: latestKnownDate([item.funnelCutoff, item.ordersCutoff]), sales: item.salesCutoff, adverts: item.advertsCutoff };
      for (const total of item.totals) cutoffsByNm.set(Number(total.nm_id), cutoffs);
    }

    // рекламный и товарный трафик по (nm_id, date) — отдельно от rnp_daily(_sku) RPC
    const viewsByNm = new Map<number, Map<string, number>>();
    const clicksByNm = new Map<number, Map<string, number>>();
    const openCardByNm = new Map<number, Map<string, number>>();
    const cartByNm = new Map<number, Map<string, number>>();
    for (const r of adRows) {
      const d = String(r.date).slice(0, 10);
      if (!viewsByNm.has(r.nm_id)) { viewsByNm.set(r.nm_id, new Map()); clicksByNm.set(r.nm_id, new Map()); }
      viewsByNm.get(r.nm_id)!.set(d, (viewsByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.views ?? 0));
      clicksByNm.get(r.nm_id)!.set(d, (clicksByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.clicks ?? 0));
    }
    for (const r of funnelRows) {
      const d = String(r.date).slice(0, 10);
      if (!openCardByNm.has(r.nm_id)) openCardByNm.set(r.nm_id, new Map());
      if (!cartByNm.has(r.nm_id)) cartByNm.set(r.nm_id, new Map());
      openCardByNm.get(r.nm_id)!.set(d, (openCardByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.open_card ?? 0));
      cartByNm.get(r.nm_id)!.set(d, (cartByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.add_to_cart ?? 0));
    }
    // агрегат по всем nm — для сводки строки
    const viewsByDateAll = new Map<string, number>();
    const clicksByDateAll = new Map<string, number>();
    const openCardByDateAll = new Map<string, number>();
    const cartByDateAll = new Map<string, number>();
    for (const r of adRows) {
      const d = String(r.date).slice(0, 10);
      viewsByDateAll.set(d, (viewsByDateAll.get(d) ?? 0) + Number(r.views ?? 0));
      clicksByDateAll.set(d, (clicksByDateAll.get(d) ?? 0) + Number(r.clicks ?? 0));
    }
    for (const r of funnelRows) {
      const d = String(r.date).slice(0, 10);
      openCardByDateAll.set(d, (openCardByDateAll.get(d) ?? 0) + Number(r.open_card ?? 0));
      cartByDateAll.set(d, (cartByDateAll.get(d) ?? 0) + Number(r.add_to_cart ?? 0));
    }
    // полный расход МП на nm = комиссия + эквайринг + прочие удержания (логистика/хранение/штрафы/…) + account-overhead
    const wbCostForNm = (nm: number) => {
      const rates = resolveWbRatesForNm(comm, nm);
      return rates.factual ? rates.marketplacePct + rates.acquiringPct : null;
    };

    const days: string[] = [];
    const cur = new Date(from), end = new Date(to);
    while (cur <= end) { days.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
    const asOf = cutoffAsOf(latestKnownDate([ordersCutoff, salesCutoff, advertsCutoff, funnelCutoff]), periodEnd);
    const metricCutoffs: MetricCutoffs = { orders: ordersCutoff, sales: salesCutoff, adverts: advertsCutoff };
    const funnelCutoffs: FunnelCutoffs = { adverts: advertsCutoff, funnel: funnelCutoff };
    const period = days.map((d) => { const dt = new Date(d); return { label: `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`, period_type: WEEKDAY[dt.getDay()] }; });

    const dailyByDate = new Map<string, DailyRow>();
    for (const r of skuDailyRows) {
      const date = String(r.d).slice(0, 10);
      const current = dailyByDate.get(date) ?? { d: date, orders_count: 0, orders_sum: 0, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0 };
      current.orders_count += Number(r.orders_count ?? 0);
      current.orders_sum += Number(r.orders_sum ?? 0);
      current.buyouts_count += Number(r.buyouts_count ?? 0);
      current.buyouts_sum += Number(r.buyouts_sum ?? 0);
      current.ad_spent += Number(r.ad_spent ?? 0);
      dailyByDate.set(date, current);
    }

    const nameByArt = new Map<string, string>();
    for (const cost of costs) nameByArt.set(cost.article, cost.name ?? "");
    const totalByNm = new Map<number, RpcTotal>();
    for (const total of totals) {
      const existing = totalByNm.get(total.nm_id);
      totalByNm.set(total.nm_id, existing ? {
        nm_id: total.nm_id,
        article: existing.article || total.article,
        stock: Number(existing.stock ?? 0) + Number(total.stock ?? 0),
        cost: existing.cost ?? total.cost,
      } : total);
    }
    const stockTotal = [...totalByNm.values()].reduce((sum, row) => sum + Number(row.stock ?? 0), 0);
    const stockMoneyTotal = [...totalByNm.values()].reduce((sum, row) => sum + Number(row.stock ?? 0) * Number(row.cost ?? 0), 0);
    const byNm = new Map<number, Map<string, DailyRow>>();
    for (const row of skuDailyRows) {
      const date = String(row.d).slice(0, 10);
      const dateMap = byNm.get(row.nm_id) ?? new Map<string, DailyRow>();
      const current = dateMap.get(date) ?? { d: date, orders_count: 0, orders_sum: 0, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0 };
      current.orders_count += Number(row.orders_count ?? 0);
      current.orders_sum += Number(row.orders_sum ?? 0);
      current.buyouts_count += Number(row.buyouts_count ?? 0);
      current.buyouts_sum += Number(row.buyouts_sum ?? 0);
      current.ad_spent += Number(row.ad_spent ?? 0);
      dateMap.set(date, current);
      byNm.set(row.nm_id, dateMap);
    }

    const skus = [...totalByNm.values()]
      .map((t) => {
        const dmap = byNm.get(t.nm_id) ?? new Map<string, DailyRow>();
        const metrics = buildMetrics(days, asOf, dmap, Number(t.stock ?? 0), Math.round(Number(t.stock ?? 0) * Number(t.cost ?? 0)), cutoffsByNm.get(t.nm_id) ?? metricCutoffs, Number(t.cost ?? 0), wbCostForNm(t.nm_id));
        metrics.unshift(...buildFunnelMetrics(days, asOf, viewsByNm.get(t.nm_id) ?? new Map(), clicksByNm.get(t.nm_id) ?? new Map(), openCardByNm.get(t.nm_id) ?? new Map(), cartByNm.get(t.nm_id) ?? new Map(), funnelCutoffs));
        const orders = metrics.find((m) => m.field === "orders_count")?.total ?? 0;
        return { nm: t.nm_id, art: t.article || String(t.nm_id), name: nameByArt.get(t.article) || t.article || String(t.nm_id), img_url: wbCardImageUrl(t.nm_id), metrics, _o: orders };
      })
      .sort((a, b) => b._o - a._o)
      .map(({ _o, ...rest }) => { void _o; return rest; });

    // Сводка: базовые метрики из дневной агрегации + Валовая/Маржа вклеиваем суммой по SKU (себес разный)
    const summary = buildMetrics(days, asOf, dailyByDate, stockTotal, Math.round(stockMoneyTotal), metricCutoffs);
    summary.unshift(...buildFunnelMetrics(days, asOf, viewsByDateAll, clicksByDateAll, openCardByDateAll, cartByDateAll, funnelCutoffs));
    const sumDaily = (field: string) => days.map((_, i) => {
      let acc = 0, any = false;
      for (const sk of skus) { const m = sk.metrics.find((x) => x.field === field); const v = m?.daily[i]; if (v != null) { acc += Number(v); any = true; } }
      return any ? Math.round(acc) : null;
    });
    const grossDaily = sumDaily("gross");
    const costedSkus = skus.filter((sku) => sku.metrics.some((metric) => metric.field === "gross" && metric.total != null));
    const costedSkuCount = costedSkus.length;
    const economyCoveragePct = skus.length ? Math.round(costedSkuCount / skus.length * 1_000) / 10 : 0;
    const costKnownSkuCount = [...totalByNm.values()].filter((row) => Number(row.cost ?? 0) > 0).length;
    const ratesKnownSkuCount = [...totalByNm.values()].filter((row) => resolveWbRatesForNm(comm, row.nm_id).factual).length;
    const economyQualityReason: Metric["qualityReason"] = costKnownSkuCount < skus.length
      ? "missing_cost"
      : ratesKnownSkuCount < skus.length
        ? "missing_rates"
        : undefined;
    const grossTotal = knownSum(grossDaily);
    const costedBuyoutsSumDaily = days.map((_, index) => {
      let sum = 0, any = false;
      for (const sku of costedSkus) {
        const gross = sku.metrics.find((metric) => metric.field === "gross")?.daily[index];
        const buyouts = sku.metrics.find((metric) => metric.field === "buyouts_sum")?.daily[index];
        if (gross != null && buyouts != null) { sum += Number(buyouts); any = true; }
      }
      return any ? sum : null;
    });
    const costedBuyoutsSumTotal = knownSum(costedBuyoutsSumDaily);
    const grossMetric = summary.find((metric) => metric.field === "gross");
    if (grossMetric) Object.assign(grossMetric, {
      daily: grossDaily,
      total: grossTotal == null ? null : Math.round(grossTotal),
      forecast: null,
      source: "WB Финотчёт + себестоимость + WB Реклама",
      group_start: true,
    });
    const marginMetric = summary.find((metric) => metric.field === "margin_pct");
    if (marginMetric) Object.assign(marginMetric, {
      daily: days.map((day, index) => {
        const buyouts = Number(costedBuyoutsSumDaily[index] ?? 0);
        const gross = grossDaily[index];
        return day <= asOf && buyouts > 0 && gross != null ? Math.round((gross / buyouts) * 1000) / 10 : null;
      }),
      total: grossTotal != null && costedBuyoutsSumTotal != null && costedBuyoutsSumTotal > 0
        ? Math.round((grossTotal / costedBuyoutsSumTotal) * 1000) / 10
        : null,
      forecast: null,
      source: "WB Финотчёт + себестоимость + WB Реклама",
    });
    applyMetricForecasts(summary, days, asOf);
    if (marginMetric) {
      applyForecast(
        marginMetric,
        forecastRatioMetric(
          forecastAdditiveMetric(days, grossDaily, asOf),
          forecastAdditiveMetric(days, costedBuyoutsSumDaily, asOf),
        ),
        days,
        asOf,
      );
    }
    // GMROI сводки — из агрегированной валовой / деньги в остатках
    const gmroiM = summary.find((m) => m.field === "gmroi");
    if (gmroiM) {
      gmroiM.total = costedSkuCount && grossTotal != null && stockMoneyTotal > 0 ? Math.round(Math.min(999, (grossTotal / stockMoneyTotal) * 100) * 10) / 10 : null;
      gmroiM.daily = pointInTimeMetricDaily(days, asOf, gmroiM.total);
    }
    for (const metric of summary.filter((item) => ["gross", "margin_pct", "money", "gmroi"].includes(item.field))) {
      applyEconomyMetricCoverage(
        metric,
        economyCoveragePct,
        `Полный экономический факт для ${costedSkuCount} из ${skus.length} SKU: себестоимость ${costKnownSkuCount}, ставки WB ${ratesKnownSkuCount}.`,
        economyQualityReason,
      );
    }

    return {
      shop_label: shopLabel || "Все кабинеты",
      sku_count: skus.length,
      generated_at: new Date().toISOString(),
      as_of: asOf,
      scope_freshness: scopeData.map((item) => ({
        cabinet_id: item.scope.cabinetId,
        label: item.scope.label,
        as_of: item.asOf,
        orders_as_of: latestKnownDate([item.funnelCutoff, item.ordersCutoff]),
        sales_as_of: item.salesCutoff,
      })),
      forecast_note: "Прогноз использует факт каждого кабинета только до его последней полной даты, профиль дня недели и краткосрочный тренд. Заказы сверяются с WB Analytics → Этапы воронки продаж, WB Статистика остаётся fallback. Календарь акций WB пока не подключён.",
      period,
      summary,
      skus,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось собрать РНП" };
  }
}
