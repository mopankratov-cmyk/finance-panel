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
import { wbBidTypeGroup, type WbBidTypeGroup } from "@/lib/wb/advertTypes";
import { wbCardImageUrl, wbCardImageUrlsByNmIds } from "@/lib/wb/cardImage";
import { getWbCommissionForCabinet, resolveWbRatesForNm } from "@/lib/wb/commissions";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { loadCabinetPimRowsHourly, loadCardsFromDb, type PimCardRef, type PimRow } from "@/lib/wb/cards";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";
import { loadRnpDailySkuRows } from "@/lib/rnp/rpcLoaders";
import { readWbSyncState, type WbSyncState } from "@/lib/wb/syncState";

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

interface DailyRow {
  d: string;
  orders_count: number;
  orders_sum: number;
  buyouts_count: number;
  buyouts_sum: number;
  ad_spent: number;
  /**
   * Отменённые заказы (`wb_orders.is_cancel`). `undefined` — источник факта не
   * отдаёт (RPC-путь `rnp_daily`), `0` — отдаёт и отмен не было. Разница важна:
   * иначе кабинет без покабинетного scope молча показывал бы «отмен нет».
   */
  cancels_count?: number;
  cancels_sum?: number;
  /** Возвраты (`wb_sales`, `sale_id` на R…). Загружаются на обоих путях. */
  returns_count?: number;
  returns_sum?: number;
  /** Сумма `total_price` неотменённых заказов — цена ДО скидки продавца. */
  orders_gross_sum?: number;
  /**
   * Заказы в разрезе схемы отгрузки. Заказ с неизвестным типом склада не попадает
   * ни в одну корзину, поэтому FBS + FBW может быть меньше общего числа заказов.
   */
  orders_fbs_count?: number;
  orders_fbs_sum?: number;
  orders_fbw_count?: number;
  orders_fbw_sum?: number;
  /**
   * Выкупы до вычета возвратов: `price_with_disc` (после скидки продавца, до СПП)
   * и `finished_price` (фактическая цена покупателя, после СПП). Держим отдельно
   * от `buyouts_sum`, который уже нетто, — иначе СПП считалась бы от нетто-базы.
   */
  buyouts_gross_sum?: number;
  buyouts_finished_sum?: number;
}

/** Факты, которых может не быть: складываем их отдельно, чтобы не выдать undefined за ноль. */
const OPTIONAL_FACT_FIELDS = [
  "cancels_count",
  "cancels_sum",
  "returns_count",
  "returns_sum",
  "orders_gross_sum",
  "orders_fbs_count",
  "orders_fbs_sum",
  "orders_fbw_count",
  "orders_fbw_sum",
  "buyouts_gross_sum",
  "buyouts_finished_sum",
] as const;

/**
 * Переносит/суммирует необязательные факты. Вызывается везде, где строка пересобирается
 * (наложение воронки, вычет возвратов, агрегация по дню и по SKU): при копировании
 * целевая строка пуста, поэтому сложение эквивалентно переносу.
 */
function addOptionalFacts<Row extends DailyRow>(target: Row, source: Partial<DailyRow>): Row {
  for (const field of OPTIONAL_FACT_FIELDS) {
    const value = Number(source[field]);
    if (source[field] == null || !Number.isFinite(value)) continue;
    target[field] = (target[field] ?? 0) + value;
  }
  return target;
}
interface SkuDailyRow extends DailyRow {
  nm_id: number;
}
interface RpcTotal {
  nm_id: number;
  article: string;
  stock: number;
  /** Товар в пути: к покупателю (продан, ещё не доставлен) и обратно (возврат едет на склад). */
  in_way_to_client: number;
  in_way_from_client: number;
  cost: number | null;
}
interface AdvertTypeRow { advert_id: number; bid_type: string | null }
interface AdvertStatDayRow {
  advert_id: number;
  date: string;
  views: number | null;
  clicks: number | null;
  sum_spent: number | null;
  orders: number | null;
  sum_orders: number | null;
}

interface FeedbackNmRow {
  nm_id: number;
  rating: number | null;
  created_at_wb: string | null;
}

interface AdNmRow {
  nm_id: number;
  date: string;
  views: number | null;
  clicks: number | null;
  /** Атрибуцированные к рекламе заказы за день — их пишет синк advert-stats. */
  orders: number | null;
  orders_sum: number | null;
}
interface FunnelRow {
  nm_id: number;
  date: string;
  open_card: number | null;
  add_to_cart: number | null;
  /** null — строка записана до миграции или WB поле не прислал; это не ноль. */
  add_to_wishlist?: number | null;
  orders: number | null;
  orders_sum: number | null;
}
interface ProductCostRow {
  article: string;
  name: string | null;
  cost_rub?: number | null;
  brand?: string | null;
  category?: string | null;
}
interface CabinetScope { cabinetId: string | null; label: string; allowedNmIds: Set<number> | null }
interface MetricCutoffs { orders: string | null; sales: string | null; adverts: string | null }
interface FunnelCutoffs { adverts: string | null; funnel: string | null }
type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

export interface ScopedOrderSourceRow {
  nm_id: number;
  /** Идентификатор заказа: соответствует rid сборочного задания Marketplace. */
  srid?: string | null;
  /** Сырой тип склада WB. undefined — колонки ещё нет в базе (миграция не применена). */
  warehouse_type?: string | null;
  supplier_article: string | null;
  date: string;
  total_price: number | null;
  discount_percent: number | null;
  price_with_disc: number | null;
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
  in_way_to_client?: number | null;
  in_way_from_client?: number | null;
}

export interface ScopedProductSourceRow {
  nm_id: number;
  article: string | null;
}

export function buildLightweightProductTotals(
  skuRows: Array<{ nm_id: number }>,
  stockRows: ScopedStockSourceRow[],
): RpcTotal[] {
  const nmIds = new Set<number>();
  const stockByNm = new Map<number, StockPosition>();
  for (const row of skuRows) {
    const nmId = Number(row.nm_id);
    if (Number.isFinite(nmId) && nmId > 0) nmIds.add(nmId);
  }
  for (const row of stockRows) {
    const nmId = Number(row.nm_id);
    if (!Number.isFinite(nmId) || nmId <= 0) continue;
    nmIds.add(nmId);
    stockByNm.set(nmId, addStockRow(stockByNm.get(nmId), row));
  }
  return [...nmIds]
    .sort((left, right) => left - right)
    .map((nmId) => ({
      nm_id: nmId,
      article: "",
      ...(stockByNm.get(nmId) ?? EMPTY_STOCK_POSITION),
      cost: null,
    }));
}

interface StockPosition {
  stock: number;
  in_way_to_client: number;
  in_way_from_client: number;
}

const EMPTY_STOCK_POSITION: StockPosition = { stock: 0, in_way_to_client: 0, in_way_from_client: 0 };

/** Остатки WB приходят построчно по складам — позиция SKU складывается из строк. */
function addStockRow(current: StockPosition | undefined, row: ScopedStockSourceRow): StockPosition {
  const base = current ?? EMPTY_STOCK_POSITION;
  return {
    stock: base.stock + Number(row.quantity ?? 0),
    in_way_to_client: base.in_way_to_client + Number(row.in_way_to_client ?? 0),
    in_way_from_client: base.in_way_from_client + Number(row.in_way_from_client ?? 0),
  };
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
    // Обнуляем только те необязательные факты, которые источник вообще отдал.
    ...(row.cancels_count == null ? {} : { cancels_count: 0, cancels_sum: 0 }),
    ...(row.returns_count == null ? {} : { returns_count: 0, returns_sum: 0 }),
    ...(row.orders_gross_sum == null ? {} : { orders_gross_sum: 0 }),
    ...(row.buyouts_gross_sum == null ? {} : { buyouts_gross_sum: 0, buyouts_finished_sum: 0 }),
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
      ...(isAfter(date, cutoffs.orders) && row.cancels_count != null ? { cancels_count: 0, cancels_sum: 0 } : {}),
      ...(isAfter(date, cutoffs.orders) && row.orders_gross_sum != null ? { orders_gross_sum: 0 } : {}),
      ...(isAfter(date, cutoffs.sales) ? { buyouts_count: 0, buyouts_sum: 0 } : {}),
      ...(isAfter(date, cutoffs.sales) && row.returns_count != null ? { returns_count: 0, returns_sum: 0 } : {}),
      ...(isAfter(date, cutoffs.sales) && row.buyouts_gross_sum != null ? { buyouts_gross_sum: 0, buyouts_finished_sum: 0 } : {}),
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
  qualityReason?: "no_activity" | "missing_cost" | "missing_rates" | "stale_source" | "api_error" | "unsupported_source";
  group_start?: boolean;
}

const ADDITIVE_FORECAST_FIELDS = new Set([
  "views",
  "clicks",
  "open_card",
  "cart",
  "orders_count",
  "orders_sum",
  "orders_fbs_count",
  "orders_fbs_sum",
  "orders_fbw_count",
  "orders_fbw_sum",
  "cancels_count",
  "buyouts_count",
  "buyouts_sum",
  "buyouts_gross_count",
  "returns_count",
  "returns_sum",
  "ad_spent",
  "gross",
]);

const RATIO_FORECAST_FIELDS: Record<string, { numerator: string; denominator: string }> = {
  ctr: { numerator: "clicks", denominator: "views" },
  cart_cr: { numerator: "cart", denominator: "open_card" },
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

/**
 * Доли отмен и возвратов не проходят через `RATIO_FORECAST_FIELDS`: знаменатель у них —
 * сумма двух метрик (заказы + отмены, выкупы + возвраты), готового поля под неё нет,
 * поэтому прогноз им не строим. Но покрытие обязано опускаться до слабейшего из
 * источников — иначе наполовину загруженный период выдавал бы «ready».
 */
export function applyDerivedRatioCoverage(metrics: Metric[], field: string, sourceFields: string[]) {
  const metric = metrics.find((item) => item.field === field);
  if (!metric) return metrics;
  const sources = sourceFields
    .map((source) => metrics.find((item) => item.field === source))
    .filter((item): item is Metric => !!item);
  if (!sources.length) return metrics;
  const coveragePct = metric.total == null ? 0 : Math.min(...sources.map((item) => item.coveragePct ?? 0));
  metric.coveragePct = coveragePct;
  metric.status = statusForCoverage(coveragePct);
  if (!metric.qualityReason) {
    if (metric.total == null) metric.qualityReason = "no_activity";
    else if (coveragePct < 100) metric.qualityReason = "stale_source";
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
  // Атрибуцированные заказы рекламы; опционально, чтобы не ломать вызовы без них.
  ads?: { ordersByDate: Map<string, number>; ordersSumByDate: Map<string, number> },
  /** Добавления в избранное; дни без данных остаются null — поле новое в WB API. */
  wishlistByDate?: Map<string, number>,
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
  // Конверсия в корзину: доля переходов, дошедших до корзины. Пустой день
  // источника остаётся null, а не нулём, чтобы не занижать конверсию.
  const cartCr = days.map((_, index) => Number(openCard[index]) > 0 && cart[index] != null
    ? Math.round((Number(cart[index]) / Number(openCard[index])) * 1000) / 10
    : null);
  const totalViews = knownSum(views);
  const totalClicks = knownSum(clicks);
  const totalOpenCard = knownSum(openCard);
  const totalCart = knownSum(cart);
  const adOrders = ads ? days.map((day) => read(ads.ordersByDate, day, cutoffs.adverts)) : null;
  const adOrdersSum = ads ? days.map((day) => read(ads.ordersSumByDate, day, cutoffs.adverts)) : null;
  const metrics: Metric[] = [
    { field: "views", label: "Рекламные показы", kind: "int", daily: views, total: totalViews, forecast: null, source: "WB Реклама", group_start: true },
    { field: "clicks", label: "Рекламные клики", kind: "int", daily: clicks, total: totalClicks, forecast: null, source: "WB Реклама" },
    { field: "ctr", label: "Рекламный CTR, %", kind: "pct", daily: ctr, total: totalViews && totalClicks != null ? Math.round((totalClicks / totalViews) * 1000) / 10 : null, forecast: null, source: "WB Реклама", note: "Рекламные клики / рекламные показы. Пустые даты источника не считаются нулём." },
    { field: "open_card", label: "Переходы в карточку", kind: "int", daily: openCard, total: knownSum(openCard), forecast: null, source: "WB Воронка", group_start: true },
    { field: "cart", label: "В корзину", kind: "int", daily: cart, total: totalCart, forecast: null, source: "WB Воронка" },
    { field: "cart_cr", label: "Конв. в корзину, %", kind: "pct", daily: cartCr, total: totalOpenCard && totalCart != null ? Math.round((totalCart / totalOpenCard) * 1000) / 10 : null, forecast: null, source: "WB Воронка", note: "Корзины / переходы в карточку. Пустые даты источника не считаются нулём." },
  ];
  if (wishlistByDate) {
    const wishlist = days.map((day) => read(wishlistByDate, day, cutoffs.funnel));
    const cartAnchor = metrics.findIndex((item) => item.field === "cart") + 1;
    metrics.splice(cartAnchor, 0, {
      field: "wishlist",
      label: "В избранное, шт.",
      kind: "int",
      daily: wishlist,
      total: knownSum(wishlist),
      forecast: null,
      source: "WB Воронка",
      note: "addToWishList из воронки WB. Поле появилось в API осенью 2025; дни, записанные до подключения, пусты — глубокая история его не отдаёт.",
    });
  }
  if (adOrders && adOrdersSum) {
    // Атрибуция WB: заказ приписывается рекламе в течение окна после клика,
    // поэтому дневная сумма может расходиться с заказами дня — это не ошибка.
    const anchor = metrics.findIndex((item) => item.field === "ctr") + 1;
    metrics.splice(anchor, 0,
      { field: "ad_orders", label: "Заказы из рекламы, шт.", kind: "int", daily: adOrders, total: knownSum(adOrders), forecast: null, source: "WB Реклама", note: "Атрибуция WB: заказ приписан кампании в течение окна после клика, поэтому день заказа может отличаться от дня клика." },
      { field: "ad_orders_sum", label: "Заказы из рекламы, ₽", kind: "money", daily: adOrdersSum, total: knownSum(adOrdersSum), forecast: null, source: "WB Реклама" },
    );
  }
  return applyMetricForecasts(metrics, days, asOf, {
    views: cutoffAsOf(cutoffs.adverts, asOf),
    clicks: cutoffAsOf(cutoffs.adverts, asOf),
    ad_orders: cutoffAsOf(cutoffs.adverts, asOf),
    ad_orders_sum: cutoffAsOf(cutoffs.adverts, asOf),
    open_card: cutoffAsOf(cutoffs.funnel, asOf),
    cart: cutoffAsOf(cutoffs.funnel, asOf),
    wishlist: cutoffAsOf(cutoffs.funnel, asOf),
    cart_cr: cutoffAsOf(cutoffs.funnel, asOf),
  });
}

/**
 * Конверсия в заказ: доля переходов в карточку, дошедших до заказа.
 * Считается уже после слияния наборов — воронка и заказы строятся раздельно
 * (разные источники и cutoff'ы), поэтому метрику нельзя собрать внутри одного из них.
 * Покрытие берём по слабейшему из двух источников, чтобы не завышать достоверность.
 */
export function appendOrderConversion(metrics: Metric[]): Metric[] {
  const openCard = metrics.find((metric) => metric.field === "open_card");
  const orders = metrics.find((metric) => metric.field === "orders_count");
  if (!openCard || !orders) return metrics;
  if (metrics.some((metric) => metric.field === "order_cr")) return metrics;

  const daily = openCard.daily.map((visits, index) => {
    const ordered = orders.daily[index];
    return Number(visits) > 0 && ordered != null
      ? Math.round((Number(ordered) / Number(visits)) * 1000) / 10
      : null;
  });
  const total = openCard.total && orders.total != null
    ? Math.round((orders.total / openCard.total) * 1000) / 10
    : null;
  const coveragePct = Math.min(openCard.coveragePct ?? 0, orders.coveragePct ?? 0);
  const metric: Metric = {
    field: "order_cr",
    label: "Конв. в заказ, %",
    kind: "pct",
    daily,
    total,
    forecast: null,
    source: "WB Воронка",
    coveragePct,
    status: statusForCoverage(coveragePct),
    note: "Заказы / переходы в карточку. Пустые даты источника не считаются нулём.",
  };
  const anchor = metrics.findIndex((item) => item.field === "cart_cr");
  if (anchor >= 0) metrics.splice(anchor + 1, 0, metric);
  else metrics.push(metric);
  return metrics;
}


/**
 * Органика = всё минус реклама, по уже собранным рядам. Считается после слияния
 * наборов: заказы и реклама приходят из разных источников с разными cutoff'ами.
 *
 * Атрибуция WB когортная (заказ приписан рекламе в течение окна после клика),
 * поэтому день органики может уйти в минус — такой день показываем нулём, а не
 * отрицательным числом, и это отражено в note. Правды в «минус три органических
 * заказа» нет, есть только смещение атрибуции между днями.
 */
export function appendOrganicMetrics(metrics: Metric[]): Metric[] {
  if (metrics.some((metric) => metric.field === "org_orders_count")) return metrics;
  const openCard = metrics.find((metric) => metric.field === "open_card");
  const clicks = metrics.find((metric) => metric.field === "clicks");
  const orders = metrics.find((metric) => metric.field === "orders_count");
  const adOrders = metrics.find((metric) => metric.field === "ad_orders");
  if (!openCard || !clicks || !orders || !adOrders) return metrics;

  const minus = (left: Array<number | null>, right: Array<number | null>) =>
    left.map((value, index) => {
      const subtrahend = right[index];
      if (value == null || subtrahend == null) return null;
      return Math.max(0, Number(value) - Number(subtrahend));
    });
  const minusTotal = (left: number | null, right: number | null) =>
    left != null && right != null ? Math.max(0, left - right) : null;

  const orgOpenCard = minus(openCard.daily, clicks.daily);
  const orgOrders = minus(orders.daily, adOrders.daily);
  const orgOpenCardTotal = minusTotal(openCard.total, clicks.total);
  const orgOrdersTotal = minusTotal(orders.total, adOrders.total);
  const weakest = (...values: Array<number | null | undefined>) =>
    Math.min(...values.map((value) => value ?? 0));

  const organic: Metric[] = [
    {
      field: "org_open_card",
      label: "Переходы органики",
      kind: "int",
      daily: orgOpenCard,
      total: orgOpenCardTotal,
      forecast: null,
      source: "WB Воронка − WB Реклама",
      coveragePct: weakest(openCard.coveragePct, clicks.coveragePct),
      status: statusForCoverage(weakest(openCard.coveragePct, clicks.coveragePct)),
      note: "Переходы в карточку минус рекламные клики. Отрицательные дни показываются нулём.",
      group_start: true,
    },
    {
      field: "org_orders_count",
      label: "Заказы органики, шт.",
      kind: "int",
      daily: orgOrders,
      total: orgOrdersTotal,
      forecast: null,
      source: "WB Воронка − WB Реклама",
      coveragePct: weakest(orders.coveragePct, adOrders.coveragePct),
      status: statusForCoverage(weakest(orders.coveragePct, adOrders.coveragePct)),
      note: "Заказы минус атрибуцированные к рекламе. Атрибуция WB когортная, поэтому день может обнулиться при всплеске рекламных заказов.",
    },
    {
      field: "org_cr_pct",
      label: "CR органики, %",
      kind: "pct",
      daily: orgOpenCard.map((visits, index) => {
        const ordered = orgOrders[index];
        return visits != null && visits > 0 && ordered != null
          ? Math.round((ordered / visits) * 1000) / 10
          : null;
      }),
      total: orgOpenCardTotal && orgOrdersTotal != null
        ? Math.round((orgOrdersTotal / orgOpenCardTotal) * 1000) / 10
        : null,
      forecast: null,
      source: "WB Воронка − WB Реклама",
      coveragePct: weakest(openCard.coveragePct, clicks.coveragePct, orders.coveragePct, adOrders.coveragePct),
      status: statusForCoverage(weakest(openCard.coveragePct, clicks.coveragePct, orders.coveragePct, adOrders.coveragePct)),
      note: "Заказы органики / переходы органики.",
    },
    {
      field: "org_share_pct",
      label: "Доля органики в переходах, %",
      kind: "pct",
      daily: openCard.daily.map((visits, index) => {
        const organicVisits = orgOpenCard[index];
        return visits != null && Number(visits) > 0 && organicVisits != null
          ? Math.round((organicVisits / Number(visits)) * 1000) / 10
          : null;
      }),
      total: openCard.total && orgOpenCardTotal != null
        ? Math.round((orgOpenCardTotal / openCard.total) * 1000) / 10
        : null,
      forecast: null,
      source: "WB Воронка − WB Реклама",
      coveragePct: weakest(openCard.coveragePct, clicks.coveragePct),
      status: statusForCoverage(weakest(openCard.coveragePct, clicks.coveragePct)),
      note: "Сколько переходов в карточку пришло не из рекламы.",
    },
  ];

  const anchor = metrics.findIndex((item) => item.field === "order_cr");
  if (anchor >= 0) metrics.splice(anchor + 1, 0, ...organic);
  else metrics.push(...organic);
  return metrics;
}

/**
 * Отзывы за период: новые в день, рейтинг новых и доля плохих (1–3★).
 * День без строк — честный ноль: отзыв либо есть, либо нет; рейтинг и доля при
 * нуле отзывов молчат. Окна старше ~35 дней неполны: синк хранит отвеченные
 * отзывы примерно месяц — об этом говорит note, а не тишина.
 */
export function buildReviewMetrics(
  days: string[],
  asOf: string,
  byDate: Map<string, { count: number; ratingSum: number; bad: number }>,
): Metric[] {
  const counts = days.map((day) => day > asOf ? null : (byDate.get(day)?.count ?? 0));
  const ratings = days.map((day) => {
    if (day > asOf) return null;
    const bucket = byDate.get(day);
    return bucket && bucket.count > 0 ? Math.round((bucket.ratingSum / bucket.count) * 100) / 100 : null;
  });
  const badShare = days.map((day) => {
    if (day > asOf) return null;
    const bucket = byDate.get(day);
    return bucket && bucket.count > 0 ? Math.round((bucket.bad / bucket.count) * 1000) / 10 : null;
  });
  let totalCount = 0;
  let totalRatingSum = 0;
  let totalBad = 0;
  for (const [day, bucket] of byDate) {
    if (day > asOf) continue;
    totalCount += bucket.count;
    totalRatingSum += bucket.ratingSum;
    totalBad += bucket.bad;
  }
  const note = "По дате создания отзыва на стороне WB. Синк хранит отвеченные отзывы ~35 дней, поэтому окна старше месяца неполны.";
  return [
    { field: "reviews_count", label: "Новые отзывы, шт.", kind: "int", daily: counts, total: totalCount, forecast: null, source: "WB Отзывы", note, group_start: true },
    { field: "reviews_rating", label: "Рейтинг новых отзывов", kind: "pct", daily: ratings, total: totalCount > 0 ? Math.round((totalRatingSum / totalCount) * 100) / 100 : null, forecast: null, source: "WB Отзывы", note: "Средняя оценка отзывов, созданных в этот день. Не равна рейтингу карточки — тот копится за всю жизнь товара." },
    { field: "reviews_bad_share_pct", label: "Доля 1–3★, %", kind: "pct", daily: badShare, total: totalCount > 0 ? Math.round((totalBad / totalCount) * 1000) / 10 : null, forecast: null, source: "WB Отзывы", note: "Доля новых отзывов с оценкой 1–3." },
  ];
}

export interface AdTypeDayBucket { spent: number; views: number; clicks: number; orders: number; ordersSum: number }

/**
 * Сплит рекламы по видам кампаний — только в сводке: тип живёт на кампании,
 * и по SKU честно не распределяется (одна кампания крутит несколько товаров).
 * Кампании с неопознанным типом не приписываются ни к одной группе — их расход
 * виден в note, а не растворён в чужой группе.
 */
export function buildAdTypeMetrics(
  days: string[],
  asOf: string,
  buckets: Map<string, Map<string, AdTypeDayBucket>>,
  unclassifiedSpent: number,
  advertsCutoff: string | null,
): Metric[] {
  const groups: Array<{ key: WbBidTypeGroup; label: string }> = [
    { key: "manual", label: "Ручная" },
    { key: "unified", label: "Единая" },
  ];
  const read = (group: string, day: string, pick: (bucket: AdTypeDayBucket) => number) => {
    if (!advertsCutoff || day > asOf || day > advertsCutoff) return null;
    const bucket = buckets.get(group)?.get(day);
    return bucket ? pick(bucket) : 0;
  };
  const metrics: Metric[] = [];
  const baseNote = unclassifiedSpent > 0
    ? ` Кампании с неопознанным типом (${Math.round(unclassifiedSpent).toLocaleString("ru-RU")} ₽ расхода за период) не вошли ни в одну группу.`
    : "";
  for (const group of groups) {
    const rows: Array<{ field: string; label: string; kind: Metric["kind"]; pick: (bucket: AdTypeDayBucket) => number; round?: boolean }> = [
      { field: `ads_${group.key}_spent`, label: `${group.label}: расход, ₽`, kind: "money", pick: (bucket) => bucket.spent, round: true },
      { field: `ads_${group.key}_views`, label: `${group.label}: показы`, kind: "int", pick: (bucket) => bucket.views },
      { field: `ads_${group.key}_clicks`, label: `${group.label}: клики`, kind: "int", pick: (bucket) => bucket.clicks },
      { field: `ads_${group.key}_orders`, label: `${group.label}: заказы, шт.`, kind: "int", pick: (bucket) => bucket.orders },
      { field: `ads_${group.key}_orders_sum`, label: `${group.label}: заказы, ₽`, kind: "money", pick: (bucket) => bucket.ordersSum, round: true },
    ];
    rows.forEach((row, index) => {
      const daily = days.map((day) => {
        const value = read(group.key, day, row.pick);
        return value == null ? null : row.round ? Math.round(value) : value;
      });
      metrics.push({
        field: row.field,
        label: row.label,
        kind: row.kind,
        daily,
        total: knownSum(daily),
        forecast: null,
        source: "WB Реклама (по кампаниям)",
        note: `Только в сводке: тип ставки живёт на кампании и по SKU не распределяется.${baseNote}`,
        ...(index === 0 ? { group_start: true } : {}),
      });
    });
  }
  return metrics;
}

export function calculateTurnoverDays(
  stock: number,
  values: Array<number | null>,
  windowDays: number,
): number | null {
  const observed = values
    .filter((value): value is number => value != null && Number.isFinite(value))
    .slice(-Math.max(1, windowDays));
  if (!observed.length) return null;
  const average = observed.reduce((sum, value) => sum + value, 0) / observed.length;
  return average > 0 ? Math.round(stock / average) : null;
}

// cost > 0 → добавляем прибыль и маржу после расходов МП. Для сводки эти метрики вклеиваются агрегатом по SKU.
/**
 * Состав экономики. Держим отдельным списком, чтобы строки таблицы существовали
 * даже когда факта нет: пустая строка с причиной честнее исчезнувшей метрики.
 */
const EMPTY_ECONOMY_FIELDS = [
  { field: "cogs", label: "Себестоимость проданного, ₽", kind: "money" },
  { field: "commission_rub", label: "Комиссия WB, ₽", kind: "money" },
  { field: "acquiring_rub", label: "Эквайринг, ₽", kind: "money" },
  { field: "logistics_rub", label: "Логистика и прочие удержания, ₽", kind: "money" },
  { field: "delivery_rub", label: "Логистика, ₽", kind: "money" },
  { field: "storage_rub", label: "Хранение, ₽", kind: "money" },
  { field: "penalty_rub", label: "Штрафы, ₽", kind: "money" },
  { field: "acceptance_rub", label: "Приёмка, ₽", kind: "money" },
  { field: "deduction_rub", label: "Прочие удержания, ₽", kind: "money" },
  { field: "mp_cost_rub", label: "Расходы МП всего, ₽", kind: "money" },
  { field: "profit_per_unit", label: "Прибыль на единицу, ₽", kind: "money" },
  { field: "romi", label: "ROMI, %", kind: "pct" },
] as const;

interface EconomyBreakdownInput {
  buyoutsSum: (number | null)[];
  buyoutsCount: (number | null)[];
  adSpend: (number | null)[];
  gross: (number | null)[];
  cost: number;
  wbCostPct: number | null;
  rates: {
    commissionPct: number;
    acquiringPct: number;
    extraPct: number;
    overheadPct: number;
    extraParts?: { delivery: number; storage: number; penalty: number; acceptance: number; deduction: number } | null;
  } | null;
}

/**
 * Разбирает прибыль на статьи расхода. Инвариант, который держим:
 * `gross = выкупы₽ − себестоимость − расходы МП − реклама`, поэтому
 * `mp_cost_rub` считается той же ставкой `wbCostPct`, что и сам `gross`,
 * а комиссия/эквайринг/прочее — её слагаемые.
 *
 * Разбивку прочих удержаний по типам (логистика, хранение, штрафы, приёмка)
 * дать нельзя: кэш ставок `wb_nm_commissions` хранит их одним `extra_pct`.
 */
function buildEconomyBreakdown(days: string[], input: EconomyBreakdownInput): Metric[] {
  const { buyoutsSum, buyoutsCount, adSpend, gross, cost, wbCostPct, rates } = input;
  // Каждая статья молчит по СВОЕЙ причине: расходы маркетплейса упираются в ставки,
  // себестоимость и прибыль — в справочник себестоимости.
  const costReason: Metric["qualityReason"] = cost > 0 ? undefined : "missing_cost";
  const rateReason: Metric["qualityReason"] = wbCostPct != null ? undefined : "missing_rates";
  const profitReason: Metric["qualityReason"] = cost > 0 && wbCostPct != null ? undefined : (cost > 0 ? "missing_rates" : "missing_cost");
  const r1 = (value: number) => Math.round(value * 10) / 10;
  const share = (pct: number | null) => days.map((_, index) =>
    pct == null || buyoutsSum[index] == null ? null : Math.round(buyoutsSum[index] * pct / 100));
  const otherPct = rates ? rates.extraPct + rates.overheadPct : null;
  // Состав приходит из финотчёта; у строк кэша, записанных до разбивки, его нет.
  const parts = rates?.extraParts ?? null;
  const part = (key: "delivery" | "storage" | "penalty" | "acceptance" | "deduction") => share(parts ? parts[key] : null);
  const partsReason: Metric["qualityReason"] = rates ? (parts ? undefined : "unsupported_source") : "missing_rates";
  const cogs = cost > 0
    ? days.map((_, index) => buyoutsCount[index] == null ? null : Math.round(cost * buyoutsCount[index]))
    : days.map(() => null);
  const commission = share(rates?.commissionPct ?? null);
  const acquiring = share(rates?.acquiringPct ?? null);
  const other = share(otherPct);
  const marketplace = share(wbCostPct ?? null);
  const totalGross = knownSum(gross);
  const totalBuyoutsCount = knownSum(buyoutsCount);
  const totalAdSpend = knownSum(adSpend);
  // Ставки по статьям приходят вместе; если их нет — молчат только они,
  // общая сумма расходов МП остаётся, она считается из wbCostPct.
  // Разбивка по статьям требует состава ставок; общая сумма — только самих ставок.
  const ratesReason: Metric["qualityReason"] = wbCostPct == null ? "missing_rates" : (rates ? undefined : "missing_rates");
  const money = (field: string, label: string, daily: (number | null)[], note: string, qualityReason?: Metric["qualityReason"]) => ({
    field,
    label,
    kind: "money",
    daily,
    total: knownSum(daily) == null ? null : Math.round(knownSum(daily)!),
    forecast: null,
    source: "WB Финотчёт + себестоимость",
    note,
    qualityReason,
  } satisfies Metric);

  return [
    money("cogs", "Себестоимость проданного, ₽", cogs, "Себестоимость × выкупы, шт. Выкупы нетто — возвраты уже вычтены.", costReason),
    money("commission_rub", "Комиссия WB, ₽", commission, "Выкупы × фактическая ставка комиссии из финотчёта.", ratesReason),
    money("acquiring_rub", "Эквайринг, ₽", acquiring, "Выкупы × фактическая ставка эквайринга из финотчёта.", ratesReason),
    money("logistics_rub", "Логистика и прочие удержания, ₽", other, "Логистика, хранение, штрафы, приёмка и прочие удержания одной суммой. Ниже — состав по статьям.", ratesReason),
    money("delivery_rub", "Логистика, ₽", part("delivery"), "Платная логистика из финотчёта.", partsReason),
    money("storage_rub", "Хранение, ₽", part("storage"), "Платное хранение из финотчёта.", partsReason),
    money("penalty_rub", "Штрафы, ₽", part("penalty"), "Штрафы из финотчёта.", partsReason),
    money("acceptance_rub", "Приёмка, ₽", part("acceptance"), "Платная приёмка из финотчёта.", partsReason),
    money("deduction_rub", "Прочие удержания, ₽", part("deduction"), "Прочие удержания, кроме рекламы: она вычитается отдельной строкой. Удержания без привязки к SKU сюда не входят — они размазаны по всем товарам внутри общей суммы.", partsReason),
    money("mp_cost_rub", "Расходы МП всего, ₽", marketplace, "Комиссия + эквайринг + прочие удержания. Та же ставка, которой считается прибыль. Себестоимость для этой строки не нужна.", rateReason),
    {
      field: "profit_per_unit",
      label: "Прибыль на единицу, ₽",
      kind: "money",
      daily: days.map((_, index) => gross[index] != null && buyoutsCount[index] != null && buyoutsCount[index] > 0
        ? Math.round(gross[index] / buyoutsCount[index])
        : null),
      total: totalGross != null && totalBuyoutsCount != null && totalBuyoutsCount > 0 ? Math.round(totalGross / totalBuyoutsCount) : null,
      forecast: null,
      source: "WB Финотчёт + себестоимость + WB Реклама",
      note: "Прибыль после расходов МП / выкупы, шт.",
      qualityReason: profitReason,
    },
    {
      field: "romi",
      label: "ROMI, %",
      kind: "pct",
      daily: days.map((_, index) => gross[index] != null && adSpend[index] != null && adSpend[index] > 0
        ? r1((gross[index] / adSpend[index]) * 100)
        : null),
      total: totalGross != null && totalAdSpend != null && totalAdSpend > 0 ? r1((totalGross / totalAdSpend) * 100) : null,
      forecast: null,
      source: "WB Финотчёт + себестоимость + WB Реклама",
      note: "Прибыль после расходов МП (реклама уже вычтена) / рекламный расход. 0% — реклама вышла в ноль, ниже нуля — не окупилась. Без рекламы метрика молчит.",
      qualityReason: profitReason,
    },
  ];
}

export function buildMetrics(
  days: string[],
  asOf: string,
  byDate: Map<string, DailyRow>,
  stock: number,
  stockMoney: number,
  cutoffs: MetricCutoffs,
  cost = 0,
  wbCostPct: number | null = null,
  turnoverWindowDays = 30,
  /**
   * `primaryFacts: false` — среди источников есть путь, который читает не первичные
   * строки, а агрегат (RPC `rnp_daily`). Он не отдаёт ни отмены, ни цены до скидки,
   * ни фактическую цену покупателя. Такие метрики молчат, а не показывают
   * заниженный ноль.
   *
   * `inWayToClient` / `inWayFromClient` — снимок товара в пути из `wb_stocks`,
   * приходит вместе с остатком и живёт в той же точке времени.
   *
   * `rates` — те же ставки, из которых собран `wbCostPct`, но не схлопнутые: нужны,
   * чтобы показать расходы МП по статьям, а не одной суммой.
   */
  options: {
    primaryFacts?: boolean;
    /** `false` — тип склада недоступен: колонки нет в базе либо источник её не отдаёт. */
    schemeFacts?: boolean;
    inWayToClient?: number;
    inWayFromClient?: number;
    rates?: {
      commissionPct: number;
      acquiringPct: number;
      extraPct: number;
      overheadPct: number;
      extraParts?: { delivery: number; storage: number; penalty: number; acceptance: number; deduction: number } | null;
    } | null;
  } = {},
): Metric[] {
  const pick = (key: keyof DailyRow, cutoff: string | null) => days.map((day) =>
    !cutoff || day > asOf || day > cutoff ? null : Number(byDate.get(day)?.[key] ?? 0));
  const r1 = (value: number) => Math.round(value * 10) / 10;
  const ordersCount = pick("orders_count", cutoffs.orders);
  const ordersSum = pick("orders_sum", cutoffs.orders);
  const buyoutsCount = pick("buyouts_count", cutoffs.sales);
  const buyoutsSum = pick("buyouts_sum", cutoffs.sales);
  const adSpend = pick("ad_spent", cutoffs.adverts);
  const primaryFacts = options.primaryFacts !== false;
  const blank = days.map(() => null);
  const cancelsCount = primaryFacts ? pick("cancels_count", cutoffs.orders) : blank;
  const cancelsSum = primaryFacts ? pick("cancels_sum", cutoffs.orders) : blank;
  const returnsCount = pick("returns_count", cutoffs.sales);
  const returnsSum = pick("returns_sum", cutoffs.sales);
  const ordersGrossSum = primaryFacts ? pick("orders_gross_sum", cutoffs.orders) : blank;
  // Схема известна, только если её отдал путь первичных строк И колонка есть в базе.
  const schemeFacts = primaryFacts && options.schemeFacts !== false;
  const ordersFbsCount = schemeFacts ? pick("orders_fbs_count", cutoffs.orders) : blank;
  const ordersFbsSum = schemeFacts ? pick("orders_fbs_sum", cutoffs.orders) : blank;
  const ordersFbwCount = schemeFacts ? pick("orders_fbw_count", cutoffs.orders) : blank;
  const ordersFbwSum = schemeFacts ? pick("orders_fbw_sum", cutoffs.orders) : blank;
  // Доля считается от заказов с ИЗВЕСТНОЙ схемой, а не от всех: иначе заказы без
  // типа склада молча занижали бы долю FBS.
  const fbsSharePct = days.map((_, index) => {
    if (ordersFbsSum[index] == null || ordersFbwSum[index] == null) return null;
    const known = ordersFbsSum[index] + ordersFbwSum[index];
    return known > 0 ? r1((ordersFbsSum[index] / known) * 100) : null;
  });
  const buyoutsGrossSum = primaryFacts ? pick("buyouts_gross_sum", cutoffs.sales) : blank;
  const buyoutsFinishedSum = primaryFacts ? pick("buyouts_finished_sum", cutoffs.sales) : blank;
  // Средние цены: считаем по факту дня, деление на ноль отдаём как «нет данных».
  const perUnit = (sum: (number | null)[], count: (number | null)[]) => days.map((_, index) =>
    sum[index] != null && count[index] != null && count[index] > 0 ? Math.round(sum[index] / count[index]) : null);
  const avgOrderPrice = perUnit(ordersSum, ordersCount);
  const avgBuyoutPrice = perUnit(buyoutsSum, buyoutsCount);
  // Брутто-выкупы = нетто + возвраты: R-строка приходит в свою дату, и нетто-выкупы
  // уже уменьшены на неё, поэтому сумма восстанавливает исходное число S-строк.
  const grossBuyoutsCount = days.map((_, index) => buyoutsCount[index] != null && returnsCount[index] != null
    ? buyoutsCount[index] + returnsCount[index]
    : null);
  const finalPrice = perUnit(buyoutsFinishedSum, grossBuyoutsCount);
  // Скидка продавца: насколько цена заказа ниже цены до скидки.
  const sellerDiscountPct = days.map((_, index) =>
    ordersGrossSum[index] != null && ordersSum[index] != null && ordersGrossSum[index] > 0
      ? r1((1 - ordersSum[index] / ordersGrossSum[index]) * 100)
      : null);
  // СПП — скидка WB поверх цены продавца: продавец получает price_with_disc,
  // покупатель платит finished_price. Считаем от брутто-выкупов, не от нетто.
  // Заказы по цене для покупателя: та же СПП, что применилась к продажам дня.
  const ordersSppSum = days.map((_, index) => {
    if (ordersSum[index] == null || buyoutsGrossSum[index] == null || buyoutsFinishedSum[index] == null) return null;
    if (!(buyoutsGrossSum[index] > 0)) return null;
    return Math.round(ordersSum[index] * (buyoutsFinishedSum[index] / buyoutsGrossSum[index]));
  });
  // Фактический % выкупа = выкуплено / доставлено = выкупы / (выкупы + возвраты).
  // Знаменатель — брутто-выкупы плюс возвраты: это и есть доставленное покупателю.
  const actualBuyoutPct = days.map((_, index) => {
    if (grossBuyoutsCount[index] == null || returnsCount[index] == null) return null;
    const delivered = grossBuyoutsCount[index] + returnsCount[index];
    return delivered > 0 ? r1((grossBuyoutsCount[index] / delivered) * 100) : null;
  });
  const sppPct = days.map((_, index) =>
    buyoutsGrossSum[index] != null && buyoutsFinishedSum[index] != null && buyoutsGrossSum[index] > 0
      ? r1((1 - buyoutsFinishedSum[index] / buyoutsGrossSum[index]) * 100)
      : null);
  // Доля отмен считается к оформленным заказам = доставленный поток + отмены.
  const cancelPct = days.map((_, index) => {
    if (cancelsCount[index] == null || ordersCount[index] == null) return null;
    const placed = ordersCount[index] + cancelsCount[index];
    return placed > 0 ? r1((cancelsCount[index] / placed) * 100) : null;
  });
  // Выкупы в РНП уже нетто (возвраты вычтены), поэтому знаменатель доли возвратов
  // восстанавливаем до брутто: нетто-выкупы + возвраты.
  const returnPct = days.map((_, index) => {
    if (returnsCount[index] == null || buyoutsCount[index] == null) return null;
    const grossBuyouts = buyoutsCount[index] + returnsCount[index];
    return grossBuyouts > 0 ? r1((returnsCount[index] / grossBuyouts) * 100) : null;
  });
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
  const totalCancelsCount = knownSum(cancelsCount);
  const totalCancelsSum = knownSum(cancelsSum);
  const totalReturnsCount = knownSum(returnsCount);
  const totalReturnsSum = knownSum(returnsSum);
  const totalPlaced = totalOrdersCount != null && totalCancelsCount != null ? totalOrdersCount + totalCancelsCount : null;
  const totalGrossBuyouts = totalBuyoutsCount != null && totalReturnsCount != null ? totalBuyoutsCount + totalReturnsCount : null;
  const totalOrdersSppSum = knownSum(ordersSppSum);
  const totalDelivered = totalGrossBuyouts != null && totalReturnsCount != null ? totalGrossBuyouts + totalReturnsCount : null;
  const primaryQualityReason: Metric["qualityReason"] = primaryFacts ? undefined : "unsupported_source";
  const totalOrdersGrossSum = knownSum(ordersGrossSum);
  const totalFbsSum = knownSum(ordersFbsSum);
  const totalFbwSum = knownSum(ordersFbwSum);
  const totalKnownScheme = totalFbsSum != null && totalFbwSum != null ? totalFbsSum + totalFbwSum : null;
  const schemeQualityReason: Metric["qualityReason"] = schemeFacts ? undefined : "unsupported_source";
  const totalBuyoutsGrossSum = knownSum(buyoutsGrossSum);
  const totalBuyoutsFinishedSum = knownSum(buyoutsFinishedSum);
  const ratio = (part: number | null, whole: number | null) => part != null && whole != null && whole > 0
    ? r1((1 - part / whole) * 100)
    : null;
  const perUnitTotal = (sum: number | null, count: number | null) => sum != null && count != null && count > 0
    ? Math.round(sum / count)
    : null;
  const out: Metric[] = [
    { field: "orders_count", label: "Заказы, шт", kind: "int", daily: ordersCount, total: totalOrdersCount, forecast: null, source: "WB Воронка/Статистика", note: "WB Analytics → Этапы воронки продаж; WB Статистика используется как fallback, если воронка ещё не загрузилась.", group_start: true },
    { field: "orders_sum", label: "Заказы, ₽", kind: "money", daily: ordersSum, total: totalOrdersSum == null ? null : Math.round(totalOrdersSum), forecast: null, source: "WB Воронка/Статистика", note: "WB Analytics → Этапы воронки продаж; WB Статистика используется как fallback, если воронка ещё не загрузилась." },
    {
      field: "orders_fbs_count",
      label: "Заказы FBS, шт",
      kind: "int",
      daily: ordersFbsCount,
      total: knownSum(ordersFbsCount),
      forecast: null,
      source: "WB Статистика заказов",
      note: "По сборочным заданиям Marketplace API (существуют только у FBS-заказов, сопоставление по srid). warehouseType из статистики не используется — он метит «Складом продавца» и FBO-отгрузки из СЦ.",
      qualityReason: schemeQualityReason,
      group_start: true,
    },
    {
      field: "orders_fbs_sum",
      label: "Заказы FBS, ₽",
      kind: "money",
      daily: ordersFbsSum,
      total: totalFbsSum == null ? null : Math.round(totalFbsSum),
      forecast: null,
      source: "WB Статистика заказов",
      qualityReason: schemeQualityReason,
    },
    {
      field: "orders_fbw_count",
      label: "Заказы FBW, шт",
      kind: "int",
      daily: ordersFbwCount,
      total: knownSum(ordersFbwCount),
      forecast: null,
      source: "WB Статистика заказов",
      note: "Заказы без сборочного задания Marketplace в пределах покрытого синком периода. Дни после границы покрытия не классифицируются.",
      qualityReason: schemeQualityReason,
    },
    {
      field: "orders_fbw_sum",
      label: "Заказы FBW, ₽",
      kind: "money",
      daily: ordersFbwSum,
      total: totalFbwSum == null ? null : Math.round(totalFbwSum),
      forecast: null,
      source: "WB Статистика заказов",
      qualityReason: schemeQualityReason,
    },
    {
      field: "fbs_share_pct",
      label: "Доля FBS в заказах, %",
      kind: "pct",
      daily: fbsSharePct,
      total: totalKnownScheme != null && totalKnownScheme > 0 && totalFbsSum != null
        ? r1((totalFbsSum / totalKnownScheme) * 100)
        : null,
      forecast: null,
      source: "WB Статистика заказов",
      note: "FBS / (FBS + FBW) по сумме заказов. Считается только по заказам с известным типом склада, поэтому знаменатель может быть меньше общей суммы заказов.",
      qualityReason: schemeQualityReason,
    },
    {
      field: "cancels_count",
      label: "Отмены, шт",
      kind: "int",
      daily: cancelsCount,
      total: totalCancelsCount,
      forecast: null,
      source: "WB Статистика заказов",
      note: "Заказы с признаком отмены. В поток заказов они не входят.",
      qualityReason: primaryQualityReason,
      group_start: true,
    },
    {
      field: "cancel_pct",
      label: "Доля отмен, %",
      kind: "pct",
      daily: cancelPct,
      total: totalPlaced != null && totalPlaced > 0 && totalCancelsCount != null ? r1((totalCancelsCount / totalPlaced) * 100) : null,
      forecast: null,
      source: "WB Статистика заказов",
      note: "Отмены / (заказы + отмены). Заказы могут приходить из воронки WB, а отмены — из статистики заказов, поэтому при расхождении источников доля приблизительная.",
      qualityReason: primaryQualityReason,
    },
    { field: "buyouts_count", label: "Выкупы, шт", kind: "int", daily: buyoutsCount, total: totalBuyoutsCount, forecast: null, source: "WB Статистика", group_start: true },
    { field: "buyouts_sum", label: "Выкупы, ₽", kind: "money", daily: buyoutsSum, total: totalBuyoutsSum == null ? null : Math.round(totalBuyoutsSum), forecast: null, source: "WB Статистика" },
    {
      field: "buyouts_gross_count",
      label: "Выкуплено, шт",
      kind: "int",
      daily: grossBuyoutsCount,
      total: totalGrossBuyouts,
      forecast: null,
      source: "WB Статистика",
      note: "Фактические выкупы до вычета возвратов — строки продаж WB. Отличается от «Выкупы, шт», где возвраты уже вычтены.",
    },
    {
      field: "buyouts_gross_rub",
      label: "Выкуплено, ₽",
      kind: "money",
      daily: buyoutsGrossSum,
      total: totalBuyoutsGrossSum == null ? null : Math.round(totalBuyoutsGrossSum),
      forecast: null,
      source: "WB Статистика",
      note: "Сумма выкупов до вычета возвратов, по цене продавца (до СПП).",
      qualityReason: primaryQualityReason,
    },
    {
      field: "returns_count",
      label: "Возвраты, шт",
      kind: "int",
      daily: returnsCount,
      total: totalReturnsCount,
      forecast: null,
      source: "WB Статистика",
      note: "Строки продаж с признаком возврата. Из выкупов они уже вычтены.",
    },
    {
      field: "returns_sum",
      label: "Возвраты, ₽",
      kind: "money",
      daily: returnsSum,
      total: totalReturnsSum == null ? null : Math.round(totalReturnsSum),
      forecast: null,
      source: "WB Статистика",
      note: "Сумма возвращённых строк продаж. Из выкупов, ₽ она уже вычтена.",
    },
    {
      field: "return_pct",
      label: "Доля возвратов, %",
      kind: "pct",
      daily: returnPct,
      total: totalGrossBuyouts != null && totalGrossBuyouts > 0 && totalReturnsCount != null ? r1((totalReturnsCount / totalGrossBuyouts) * 100) : null,
      forecast: null,
      source: "WB Статистика",
      note: "Возвраты / выкупы до вычета возвратов. Возврат приходит в дату оформления, а покупка могла быть раньше, поэтому дневное значение может превышать 100%.",
    },
    {
      field: "actual_buyout_pct",
      label: "Фактический % выкупа, %",
      kind: "pct",
      daily: actualBuyoutPct,
      total: totalGrossBuyouts != null && totalDelivered != null && totalDelivered > 0
        ? r1((totalGrossBuyouts / totalDelivered) * 100)
        : null,
      forecast: null,
      source: "WB Статистика",
      note: "Выкуплено / доставлено = выкупы / (выкупы + возвраты). В отличие от «Выкуп потока» считается по факту доставки, а не к заказам другой когорты.",
    },
    {
      field: "orders_spp_sum",
      label: "Заказы с СПП, ₽",
      kind: "money",
      daily: ordersSppSum,
      total: totalOrdersSppSum == null ? null : Math.round(totalOrdersSppSum),
      forecast: null,
      source: "WB Воронка/Статистика + WB Статистика",
      note: "Сумма заказов по цене для покупателя: заказы × (1 − СПП дня). «Заказы, ₽» — выручка до СПП.",
      qualityReason: primaryQualityReason,
      group_start: true,
    },
    {
      field: "avg_order_price",
      label: "Средняя цена заказа, ₽",
      kind: "money",
      daily: avgOrderPrice,
      total: perUnitTotal(totalOrdersSum, totalOrdersCount),
      forecast: null,
      source: "WB Воронка/Статистика",
      note: "Сумма заказов / количество заказов. Цена после скидки продавца, до СПП.",
      group_start: true,
    },
    {
      field: "seller_discount_pct",
      label: "Скидка продавца, %",
      kind: "pct",
      daily: sellerDiscountPct,
      total: ratio(totalOrdersSum, totalOrdersGrossSum),
      forecast: null,
      source: "WB Статистика заказов",
      note: "Насколько цена заказа ниже цены до скидки продавца. Скидка WB (СПП) сюда не входит.",
      qualityReason: primaryQualityReason,
    },
    {
      field: "avg_buyout_price",
      label: "Средняя цена выкупа, ₽",
      kind: "money",
      daily: avgBuyoutPrice,
      total: perUnitTotal(totalBuyoutsSum, totalBuyoutsCount),
      forecast: null,
      source: "WB Статистика",
      note: "Выкупы, ₽ / выкупы, шт — обе величины нетто, возвраты уже вычтены.",
    },
    {
      field: "final_price",
      label: "Цена для покупателя, ₽",
      kind: "money",
      daily: finalPrice,
      total: perUnitTotal(totalBuyoutsFinishedSum, totalGrossBuyouts),
      forecast: null,
      source: "WB Статистика",
      note: "Фактическая цена оплаты покупателем — после СПП. Продавец получает цену до СПП.",
      qualityReason: primaryQualityReason,
    },
    {
      field: "spp_pct",
      label: "СПП, %",
      kind: "pct",
      daily: sppPct,
      total: ratio(totalBuyoutsFinishedSum, totalBuyoutsGrossSum),
      forecast: null,
      source: "WB Статистика",
      note: "Скидка WB поверх цены продавца: 1 − цена покупателя / цена продавца. Выручку продавца не уменьшает.",
      qualityReason: primaryQualityReason,
    },
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
  // Прибыль требует себестоимости, расходы маркетплейса — нет: они считаются как
  // выкупы × ставка из финотчёта. Раньше весь блок жил под одним условием, и
  // незаполненный справочник себестоимости прятал в том числе комиссию с
  // логистикой, которые к нему отношения не имеют.
  const hasCost = cost > 0;
  const hasRates = wbCostPct != null;
  const gross = hasCost && hasRates
    ? days.map((_, index) =>
      buyoutsSum[index] == null || buyoutsCount[index] == null || adSpend[index] == null
        ? null
        : Math.round(
          buyoutsSum[index]
          - cost * buyoutsCount[index]
          - buyoutsSum[index] * (wbCostPct / 100)
          - adSpend[index],
        ))
    : days.map(() => null);
  const totalGross = knownSum(gross);
  const grossBuyoutsSum = knownSum(buyoutsSum.map((value, index) => gross[index] == null ? null : value));
  grossTotalForGmroi = totalGross;
  const marginPct = days.map((_, index) => buyoutsSum[index] != null && buyoutsSum[index] > 0 && gross[index] != null
    ? r1((gross[index] / buyoutsSum[index]) * 100)
    : null);
  const profitReason: Metric["qualityReason"] = hasCost && hasRates ? undefined : (!hasCost ? "missing_cost" : "missing_rates");
  out.push(
    { field: "gross", label: "Прибыль после расходов МП, ₽", kind: "money", daily: gross, total: totalGross == null ? null : Math.round(totalGross), forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама", qualityReason: profitReason, group_start: true },
    { field: "margin_pct", label: "Расчётная маржа после рекламы, %", kind: "pct", daily: marginPct, total: grossBuyoutsSum != null && totalGross != null && grossBuyoutsSum > 0 ? r1((totalGross / grossBuyoutsSum) * 100) : null, forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама", qualityReason: profitReason },
    ...buildEconomyBreakdown(days, { buyoutsSum, buyoutsCount, adSpend, gross, cost, wbCostPct, rates: options.rates ?? null }),
  );
  // Оборачиваемость, дней = остаток / средние дневные выкупы за выбранное
  // пользователем окно. Будущие/не загруженные дни не попадают в знаменатель.
  const turnoverValues = days
    .map((day, index) => ({ day, value: buyoutsCount[index] }))
    .filter((item): item is { day: string; value: number } => item.day <= asOf && item.value != null)
    .slice(-Math.max(1, turnoverWindowDays));
  const turnover = calculateTurnoverDays(stock, turnoverValues.map((item) => item.value), turnoverWindowDays);
  const gmroi = grossTotalForGmroi != null && stockMoney > 0 ? r1(Math.min(999, (grossTotalForGmroi / stockMoney) * 100)) : null;
  const knownStockMoney = stockMoney > 0 || stock === 0 ? Math.round(stockMoney) : null;
  const snapshotNote = `Текущий снимок показан в дате факта; прошлые дни не подменяются сегодняшним остатком. Оборачиваемость рассчитана по последним ${Math.max(1, turnoverWindowDays)} доступным дням.`;
  const inWayToClient = Math.round(Number(options.inWayToClient ?? 0));
  const inWayFromClient = Math.round(Number(options.inWayFromClient ?? 0));
  const stockTotalWithInWay = stock + inWayToClient + inWayFromClient;
  out.push(
    { field: "stock", label: "Остаток, шт", kind: "int", daily: pointInTimeMetricDaily(days, asOf, stock), total: stock, forecast: null, source: "WB Остатки", note: `Доступно к продаже на складах. ${snapshotNote}`, group_start: true },
    {
      field: "stock_in_way_to_client",
      label: "В пути к клиенту, шт",
      kind: "int",
      daily: pointInTimeMetricDaily(days, asOf, inWayToClient),
      total: inWayToClient,
      forecast: null,
      source: "WB Остатки",
      note: `Уже продано, но ещё не доставлено — в остаток к продаже не входит. ${snapshotNote}`,
    },
    {
      field: "stock_in_way_from_client",
      label: "В пути от клиента, шт",
      kind: "int",
      daily: pointInTimeMetricDaily(days, asOf, inWayFromClient),
      total: inWayFromClient,
      forecast: null,
      source: "WB Остатки",
      note: `Возвраты, которые едут обратно на склад, — ранний признак роста возвратов. ${snapshotNote}`,
    },
    {
      field: "stock_total",
      label: "Всего на складах, шт",
      kind: "int",
      daily: pointInTimeMetricDaily(days, asOf, stockTotalWithInWay),
      total: stockTotalWithInWay,
      forecast: null,
      source: "WB Остатки",
      note: `Остаток к продаже плюс товар в пути в обе стороны. ${snapshotNote}`,
    },
    { field: "money", label: "Деньги в остатках, ₽", kind: "money", daily: pointInTimeMetricDaily(days, asOf, knownStockMoney), total: knownStockMoney, forecast: null, source: "WB Остатки + себестоимость", note: snapshotNote, qualityReason: knownStockMoney == null && stock > 0 ? "missing_cost" : undefined },
    { field: "turnover", label: "Оборачиваемость, дней", kind: "int", daily: pointInTimeMetricDaily(days, asOf, turnover), total: turnover, forecast: null, source: "WB Остатки + выкупы", note: snapshotNote, qualityReason: turnover == null ? "no_activity" : undefined },
    { field: "gmroi", label: "GMROI, %", kind: "pct", daily: pointInTimeMetricDaily(days, asOf, gmroi), total: gmroi, forecast: null, source: "Расчётная прибыль / деньги в остатках", note: snapshotNote, qualityReason: cost <= 0 && stock > 0 ? "missing_cost" : wbCostPct == null ? "missing_rates" : gmroi == null ? "no_activity" : undefined },
  );
  const withForecasts = applyMetricForecasts(out, days, asOf, {
    orders_count: cutoffAsOf(cutoffs.orders, asOf),
    orders_sum: cutoffAsOf(cutoffs.orders, asOf),
    cancels_count: cutoffAsOf(cutoffs.orders, asOf),
    buyouts_count: cutoffAsOf(cutoffs.sales, asOf),
    buyouts_sum: cutoffAsOf(cutoffs.sales, asOf),
    returns_count: cutoffAsOf(cutoffs.sales, asOf),
    returns_sum: cutoffAsOf(cutoffs.sales, asOf),
    ad_spent: cutoffAsOf(cutoffs.adverts, asOf),
    gross: cutoffAsOf(earliestKnownDate([cutoffs.sales, cutoffs.adverts], asOf), asOf),
  });
  applyDerivedRatioCoverage(withForecasts, "cancel_pct", ["cancels_count", "orders_count"]);
  applyDerivedRatioCoverage(withForecasts, "return_pct", ["returns_count", "buyouts_count"]);
  applyDerivedRatioCoverage(withForecasts, "fbs_share_pct", ["orders_fbs_sum", "orders_fbw_sum"]);
  applyDerivedRatioCoverage(withForecasts, "actual_buyout_pct", ["buyouts_count", "returns_count"]);
  applyDerivedRatioCoverage(withForecasts, "orders_spp_sum", ["orders_sum", "buyouts_sum"]);
  applyDerivedRatioCoverage(withForecasts, "buyouts_gross_count", ["buyouts_count", "returns_count"]);
  applyDerivedRatioCoverage(withForecasts, "avg_order_price", ["orders_sum", "orders_count"]);
  applyDerivedRatioCoverage(withForecasts, "seller_discount_pct", ["orders_sum"]);
  applyDerivedRatioCoverage(withForecasts, "avg_buyout_price", ["buyouts_sum", "buyouts_count"]);
  applyDerivedRatioCoverage(withForecasts, "final_price", ["buyouts_count", "returns_count"]);
  applyDerivedRatioCoverage(withForecasts, "spp_pct", ["buyouts_sum"]);
  return withForecasts;
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
    adverts_as_of: string | null;
    funnel_as_of: string | null;
  }>;
  forecast_note: string;
  /**
   * Снимок карточек WB не был прогрет, поэтому название, бренд и предмет собраны
   * из справочника себестоимости. Метрики от этого не страдают, но такой снимок
   * не должен лежать в кэше полсуток — см. lib/rnp/tableCache.ts.
   */
  pim_cold?: boolean;
  /** Длительности источников в мс — чтобы медленный экран можно было измерить. */
  timings?: Record<string, number>;
  period: { label: string; period_type: string }[];
  summary: Metric[];
  skus: {
    nm: number;
    art: string;
    name: string;
    brand: string;
    subject: string;
    img_url: string;
    metrics: Metric[];
  }[];
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

function clampDateToPeriodEnd(value: string | null, periodEnd: string) {
  if (!value) return null;
  return value > periodEnd ? periodEnd : value;
}

function dateOnly(value: unknown) {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function moscowDateFromIso(value: unknown): string | null {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function sourceCutoffFromSyncState(
  state: WbSyncState | null,
  periodEnd: string,
  options: { preferLastPeriodEnd?: boolean } = {},
): string | null {
  if (!state || state.lastError) return null;
  const coveragePct = Number(state.state.coveragePct);
  const complete = state.status === "caught_up" || (Number.isFinite(coveragePct) && coveragePct >= 99.9);
  if (!complete) return null;
  const period = typeof state.state.lastPeriod === "object" && state.state.lastPeriod !== null
    ? state.state.lastPeriod as { end?: unknown }
    : null;
  const periodEndDate = options.preferLastPeriodEnd ? dateOnly(period?.end) : null;
  return clampDateToPeriodEnd(periodEndDate ?? moscowDateFromIso(state.state.lastSyncedAt ?? state.updatedAt), periodEnd);
}

function scopedDailyKey(nmId: number, date: string) {
  return `${nmId}:${date}`;
}

function readDate(value: unknown) {
  return String(value ?? "").slice(0, 10);
}

function orderPriceBeforeSpp(order: ScopedOrderSourceRow): number {
  const stored = Number(order.price_with_disc);
  if (Number.isFinite(stored)) return stored;
  return Number(order.total_price ?? 0) * (1 - Number(order.discount_percent ?? 0) / 100);
}

export function applyFunnelOrdersOverlay(rows: SkuDailyRow[], funnelRows: FunnelRow[]): SkuDailyRow[] {
  const dailyRows = new Map<string, SkuDailyRow>();
  for (const row of rows) {
    const nmId = Number(row.nm_id);
    const date = readDate(row.d);
    if (!Number.isFinite(nmId) || !date) continue;
    dailyRows.set(scopedDailyKey(nmId, date), addOptionalFacts({
      d: date,
      nm_id: nmId,
      orders_count: Number(row.orders_count ?? 0),
      orders_sum: Number(row.orders_sum ?? 0),
      buyouts_count: Number(row.buyouts_count ?? 0),
      buyouts_sum: Number(row.buyouts_sum ?? 0),
      ad_spent: Number(row.ad_spent ?? 0),
    }, row) as SkuDailyRow);
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

export function applySalesReturnsAdjustment(rows: SkuDailyRow[], returnRows: ScopedSaleSourceRow[]): SkuDailyRow[] {
  const dailyRows = new Map<string, SkuDailyRow>();
  for (const row of rows) {
    const nmId = Number(row.nm_id);
    const date = readDate(row.d);
    if (!Number.isFinite(nmId) || !date) continue;
    // Возвраты грузятся на обоих путях загрузки, поэтому явный ноль ставим всем
    // строкам: день без возврата — это «возвратов не было», а не «нет данных».
    dailyRows.set(scopedDailyKey(nmId, date), addOptionalFacts({
      d: date,
      nm_id: nmId,
      orders_count: Number(row.orders_count ?? 0),
      orders_sum: Number(row.orders_sum ?? 0),
      buyouts_count: Number(row.buyouts_count ?? 0),
      buyouts_sum: Number(row.buyouts_sum ?? 0),
      ad_spent: Number(row.ad_spent ?? 0),
      returns_count: 0,
      returns_sum: 0,
    }, row) as SkuDailyRow);
  }

  for (const returnRow of returnRows) {
    const nmId = Number(returnRow.nm_id);
    const date = readDate(returnRow.date);
    if (!Number.isFinite(nmId) || !date || !String(returnRow.sale_id ?? "").startsWith("R")) continue;
    const key = scopedDailyKey(nmId, date);
    const current = dailyRows.get(key) ?? {
      d: date,
      nm_id: nmId,
      orders_count: 0,
      orders_sum: 0,
      buyouts_count: 0,
      buyouts_sum: 0,
      ad_spent: 0,
      returns_count: 0,
      returns_sum: 0,
    };
    const amount = Number(returnRow.price_with_disc ?? returnRow.finished_price ?? 0);
    const money = Number.isFinite(amount) ? Math.abs(amount) : 0;
    dailyRows.set(key, {
      ...current,
      buyouts_count: current.buyouts_count - 1,
      buyouts_sum: current.buyouts_sum - money,
      returns_count: (current.returns_count ?? 0) + 1,
      returns_sum: (current.returns_sum ?? 0) + money,
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
  /** Сборочные задания Marketplace: прямой признак FBS. Без них схема молчит. */
  fbsFacts?: { srids: Set<string>; cutoff: string | null };
}): { skuRows: SkuDailyRow[]; totals: RpcTotal[] } {
  const allowed = new Set(input.allowedNmIds);
  // PostgREST не возвращает поле, если колонки нет в таблице. Значит наличие ключа
  // (пусть даже со значением null) — признак того, что миграция применена.
  //
  // ⚠️ warehouseType схему НЕ отражает: WB метит «Складом продавца» и
  // FBO-отгрузки из транзитных СЦ (сверка с кабинетом 2026-08-17). Честный
  // источник — сборочные задания Marketplace: они существуют только у
  // FBS-заказов, сопоставление по srid. Без покрытого периода схема молчит.
  const fbsSrids = input.fbsFacts?.srids;
  const fbsCutoff = input.fbsFacts?.cutoff ?? null;
  const schemeKnown = fbsSrids != null && fbsCutoff != null;
  const dailyRows = new Map<string, SkuDailyRow>();
  const articleByNm = new Map<number, string>();
  const stockByNm = new Map<number, StockPosition>();
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
    if (!allowed.has(nmId)) continue;
    const date = readDate(order.date);
    if (!date) continue;
    writeArticle(articleByNm, nmId, order.supplier_article);
    const row = touchScopedDailyRow(dailyRows, nmId, date);
    // Отменённый заказ не попадает в поток заказов (так было и раньше), но теперь
    // не теряется: считаем его отдельной метрикой вместо молчаливого пропуска.
    row.cancels_count = (row.cancels_count ?? 0) + (order.is_cancel === true ? 1 : 0);
    row.cancels_sum = (row.cancels_sum ?? 0) + (order.is_cancel === true ? orderPriceBeforeSpp(order) : 0);
    if (order.is_cancel === true) continue;
    row.orders_count += 1;
    row.orders_sum += orderPriceBeforeSpp(order);
    // Цена до скидки продавца: база для «Скидка продавца, %».
    const grossPrice = Number(order.total_price);
    row.orders_gross_sum = (row.orders_gross_sum ?? 0) + (Number.isFinite(grossPrice) ? grossPrice : orderPriceBeforeSpp(order));
    // Классификация по факту Marketplace: srid есть в сборочных заданиях → FBS,
    // нет — FBW. Дни после границы синка не классифицируем: свежее задание могло
    // ещё не доехать, и «не-FBS» там не доказан.
    if (schemeKnown && date <= fbsCutoff!) {
      if (fbsSrids!.has(String(order.srid ?? ""))) {
        row.orders_fbs_count = (row.orders_fbs_count ?? 0) + 1;
        row.orders_fbs_sum = (row.orders_fbs_sum ?? 0) + orderPriceBeforeSpp(order);
      } else {
        row.orders_fbw_count = (row.orders_fbw_count ?? 0) + 1;
        row.orders_fbw_sum = (row.orders_fbw_sum ?? 0) + orderPriceBeforeSpp(order);
      }
    }
  }
  for (const sale of input.sales) {
    const nmId = Number(sale.nm_id);
    if (!allowed.has(nmId) || !String(sale.sale_id ?? "").startsWith("S")) continue;
    const date = readDate(sale.date);
    if (!date) continue;
    const row = touchScopedDailyRow(dailyRows, nmId, date);
    const priceWithDisc = Number(sale.price_with_disc ?? sale.finished_price ?? 0);
    const finishedPrice = Number(sale.finished_price ?? sale.price_with_disc ?? 0);
    row.buyouts_count += 1;
    row.buyouts_sum += priceWithDisc;
    // Брутто-выкупы (до вычета возвратов) и фактическая цена покупателя — база для СПП.
    row.buyouts_gross_sum = (row.buyouts_gross_sum ?? 0) + priceWithDisc;
    row.buyouts_finished_sum = (row.buyouts_finished_sum ?? 0) + (Number.isFinite(finishedPrice) ? finishedPrice : 0);
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
    stockByNm.set(nmId, addStockRow(stockByNm.get(nmId), stock));
  }

  const totals = input.allowedNmIds.map((nmId) => {
    const article = articleByNm.get(nmId) ?? "";
    return {
      nm_id: nmId,
      article,
      ...(stockByNm.get(nmId) ?? EMPTY_STOCK_POSITION),
      cost: article ? (costByArticle.get(article) ?? null) : null,
    };
  });

  return {
    // Этот путь читает первичные строки заказов и продаж, поэтому отмены и цены
    // известны для КАЖДОГО дня, который он построил, — включая дни без единой
    // отмены. Явный ноль отличает «отмен не было» от «источник их не отдаёт» (RPC).
    skuRows: [...dailyRows.values()]
      .map((row) => ({
        ...row,
        cancels_count: row.cancels_count ?? 0,
        cancels_sum: row.cancels_sum ?? 0,
        // Нули по схемам ставим только в пределах границы покрытия синка FBS:
        // за её пределами «схема неизвестна», а не «FBS-заказов не было».
        ...(schemeKnown && row.d <= fbsCutoff! ? {
          orders_fbs_count: row.orders_fbs_count ?? 0,
          orders_fbs_sum: row.orders_fbs_sum ?? 0,
          orders_fbw_count: row.orders_fbw_count ?? 0,
          orders_fbw_sum: row.orders_fbw_sum ?? 0,
        } : {}),
        orders_gross_sum: row.orders_gross_sum ?? 0,
        buyouts_gross_sum: row.buyouts_gross_sum ?? 0,
        buyouts_finished_sum: row.buyouts_finished_sum ?? 0,
      }))
      .sort((a, b) => a.d.localeCompare(b.d) || a.nm_id - b.nm_id),
    totals,
  };
}

const ORDER_COLUMNS = "nm_id, srid, supplier_article, date, total_price, discount_percent, price_with_disc, is_cancel";

/** PostgREST сообщает об отсутствующей колонке текстом «column … does not exist». */
function isMissingColumnError(error: unknown, column: string): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes(column) && /does not exist/i.test(message);
}

/**
 * Заказы вместе с типом склада. Если колонки ещё нет (миграция не применена),
 * повторяем запрос без неё: непринятая миграция не должна ронять весь РНП.
 * Симметрично chunkedUpsertWithOptionalColumns на стороне записи.
 */
async function loadScopedOrders(
  db: SupabaseAdmin,
  scope: CabinetScope,
  allowed: number[],
  dateFrom: string,
  dateTo: string,
): Promise<ScopedOrderSourceRow[]> {
  const load = (columns: string) => loadAllPages<ScopedOrderSourceRow>((start, end) => {
    let query = db
      .from("wb_orders")
      .select(columns)
      .gte("date", dateFrom)
      .lt("date", dateTo)
      .in("nm_id", allowed)
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(start, end);
    if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
    return query as unknown as PromiseLike<PageResult<ScopedOrderSourceRow>>;
  });
  try {
    return await load(`${ORDER_COLUMNS}, warehouse_type`);
  } catch (error) {
    if (!isMissingColumnError(error, "warehouse_type")) throw error;
    return load(ORDER_COLUMNS);
  }
}

/**
 * FBS-факты: множество srid сборочных заданий Marketplace за период плюс граница
 * достоверности. Классифицировать «не-FBS как FBW» честно только там, где синк
 * FBS-заказов реально покрыл период: без состояния синка или при ошибке — схема
 * неизвестна, и раскладка молчит целиком.
 */
async function loadScopedFbsFacts(
  db: SupabaseAdmin,
  scope: CabinetScope,
  allowed: number[],
  dateFrom: string,
  dateTo: string,
): Promise<{ srids: Set<string>; cutoff: string | null }> {
  if (!scope.cabinetId) return { srids: new Set(), cutoff: null };
  try {
    const state = await readWbSyncState(db, scope.cabinetId, "fbs-orders");
    if (!state || state.status === "error" || !state.cursor) return { srids: new Set(), cutoff: null };
    const coveredFrom = String(state.state.coveredFrom ?? "");
    // Период начинается раньше, чем синк начал покрывать? Ранние дни назвали бы
    // FBW всё подряд — молчим по всему периоду, частичная правда тут не собирается.
    if (coveredFrom && dateFrom.slice(0, 10) < coveredFrom) return { srids: new Set(), cutoff: null };
    const rows = await loadAllPages<{ srid: string }>((start, end) => db
      .from("wb_fbs_orders")
      .select("srid")
      .eq("cabinet_id", scope.cabinetId!)
      .in("nm_id", allowed)
      .gte("created_at_wb", dateFrom)
      .lt("created_at_wb", dateTo)
      .order("srid", { ascending: true })
      .range(start, end));
    // Граница: день последнего успешного прогона. Заказ мог появиться позже —
    // дни после границы не классифицируем, как и у других источников.
    return { srids: new Set(rows.map((row) => row.srid)), cutoff: String(state.cursor).slice(0, 10) };
  } catch {
    return { srids: new Set(), cutoff: null };
  }
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
  const [orders, sales, advertSpend, stocks, products, fbsFacts] = await Promise.all([
    loadScopedOrders(db, scope, allowed, dateFrom, dateTo),
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
        .select("nm_id, quantity, in_way_to_client, in_way_from_client")
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
    loadScopedFbsFacts(db, scope, allowed, dateFrom, dateTo),
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

  return buildScopedBaseFactsFromRows({ allowedNmIds: allowed, orders, sales, advertSpend, stocks, products, costs, fbsFacts });
}

async function loadSalesReturns(
  db: SupabaseAdmin,
  scope: CabinetScope,
  allowed: number[] | null,
  from: string,
  to: string,
) {
  const dateFrom = `${from}T00:00:00.000Z`;
  const dateTo = `${nextIsoDate(to)}T00:00:00.000Z`;
  return loadAllPages<ScopedSaleSourceRow>((start, end) => {
    let query = db
      .from("wb_sales")
      .select("nm_id, date, price_with_disc, finished_price, sale_id")
      .gte("date", dateFrom)
      .lt("date", dateTo)
      .like("sale_id", "R%")
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(start, end);
    if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
    if (allowed) query = query.in("nm_id", allowed);
    return query;
  });
}

async function loadCurrentStockRows(db: SupabaseAdmin, scope: CabinetScope) {
  return loadAllPages<ScopedStockSourceRow>((start, end) => {
    let query = db
      .from("wb_stocks")
      .select("nm_id, quantity, in_way_to_client, in_way_from_client")
      .order("nm_id", { ascending: true })
      .range(start, end);
    if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
    return query;
  });
}

/**
 * Карточки для РНП: снимок, а при его отсутствии — прямой обход WB под
 * секундомером. Возвращает "cold", если карточек взять неоткуда.
 */
const RNP_PIM_TIMEOUT_MS = 8_000;

async function loadPimForRnp(cabinetId: string | null): Promise<PimCardRef[] | "cold"> {
  // База — первый источник: она видна всем роутам, в отличие от снимка в
  // кэше Next, чей ключ зависит от бандла и между роутами не совпадает.
  const stored = await loadCardsFromDb(cabinetId).catch(() => []);
  if (stored.length) return stored;
  const cached = await loadCabinetPimRowsHourly(cabinetId, { cacheOnly: true }).catch(() => null);
  if (cached) return cached;
  // Обход продолжится в фоне даже после нашего отказа ждать — и заполнит
  // и базу, и снимок, поэтому следующий запрос экрана будет уже тёплым.
  const live = loadCabinetPimRowsHourly(cabinetId).catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), RNP_PIM_TIMEOUT_MS));
  const rows = await Promise.race([live, timeout]);
  return rows ?? "cold";
}

export async function buildRnpTable(
  from: string,
  to: string,
  cabinetId?: string | null,
  shopLabel?: string,
  turnoverWindowDays = 30,
): Promise<RnpTable | { error: string }> {
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

  // Длительности источников: РНП падал по statement timeout на живых
  // кабинетах, и без разбивки не понять, какой запрос это делает.
  const timings: Record<string, number> = {};
  const timed = <T,>(name: string, promise: PromiseLike<T>): Promise<T> => {
    const startedAt = Date.now();
    return Promise.resolve(promise).then(
      (value) => { timings[name] = Math.max(timings[name] ?? 0, Date.now() - startedAt); return value; },
      (error) => { timings[name] = Math.max(timings[name] ?? 0, Date.now() - startedAt); throw error; },
    );
  };

  try {
    const periodEnd = to < currentMoscowDate() ? to : currentMoscowDate();
    const latestSyncStateDate = async (
      scope: CabinetScope,
      job: "orders" | "sales" | "advert-stats" | "funnel",
      options: { preferLastPeriodEnd?: boolean } = {},
    ) => {
      if (!scope.cabinetId || scope.allowedNmIds?.size === 0) return null;
      return sourceCutoffFromSyncState(await readWbSyncState(db, scope.cabinetId, job), periodEnd, options);
    };
    const [scopeData, costs, comm, catalog] = await Promise.all([
      Promise.all(scopes.map(async (scope) => {
        if (scope.allowedNmIds?.size === 0) {
          return {
            skuRows: [] as SkuDailyRow[],
            totals: [] as RpcTotal[],
            adRows: [] as AdNmRow[],
            funnelRows: [] as FunnelRow[],
            feedbackRows: [] as FeedbackNmRow[],
            advertTypeRows: [] as AdvertTypeRow[],
            advertStatRows: [] as AdvertStatDayRow[],
            returnRows: [] as ScopedSaleSourceRow[],
            ordersCutoff: null as string | null,
            salesCutoff: null as string | null,
            advertsCutoff: null as string | null,
            funnelCutoff: null as string | null,
            hasPrimaryFacts: true,
            scope,
            asOf: periodEnd,
          };
        }
        const allowed = scope.allowedNmIds ? [...scope.allowedNmIds] : null;
        const [
          baseFacts,
          adRows,
          funnelRows,
          feedbackRows,
          advertTypeRows,
          advertStatRows,
          returnRows,
          ordersRowCutoff,
          salesRowCutoff,
          ordersSyncCutoff,
          salesSyncCutoff,
          advertsSyncCutoff,
          funnelSyncCutoff,
        ] = await Promise.all([
          allowed
            ? timed("base_facts_scoped", loadScopedBaseFacts(db, scope, allowed, from, to))
            : timed("base_facts_rpc", Promise.all([
              loadRnpDailySkuRows<SkuDailyRow>(db, {
                from,
                to,
                cabinetId: scope.cabinetId,
                label: `${scope.label}: RNP по дням`,
              }),
              loadCurrentStockRows(db, scope),
            ]).then(([skuRows, stockRows]) => ({
              skuRows,
              totals: buildLightweightProductTotals(skuRows, stockRows),
            }))),
          timed("advert_nm_daily", loadAllPages<AdNmRow>((start, end) => {
            let query = db
              .from("wb_advert_nm_daily")
              .select("nm_id, date, views, clicks, orders, orders_sum")
              .gte("date", from)
              .lte("date", to)
              .order("date", { ascending: true })
              .order("nm_id", { ascending: true })
              .range(start, end);
            if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
            if (allowed) query = query.in("nm_id", allowed);
            return query;
          })),
          timed("funnel", (async () => {
            const loadFunnel = (columns: string) => loadAllPages<FunnelRow>((start, end) => {
              let query = db
                .from("wb_funnel_daily")
                .select(columns)
                .gte("date", from)
                .lte("date", to)
                .order("date", { ascending: true })
                .order("nm_id", { ascending: true })
                .range(start, end);
              if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
              if (allowed) query = query.in("nm_id", allowed);
              return query as unknown as PromiseLike<PageResult<FunnelRow>>;
            });
            try {
              return await loadFunnel("nm_id, date, open_card, add_to_cart, add_to_wishlist, orders, orders_sum");
            } catch (error) {
              // Миграция колонки избранного могла ещё не примениться — воронка
              // обязана работать и без неё.
              if (!isMissingColumnError(error, "add_to_wishlist")) throw error;
              return loadFunnel("nm_id, date, open_card, add_to_cart, orders, orders_sum");
            }
          })()),
          // Отзывы: новые за период, по дате создания на стороне WB. Синк хранит
          // отвеченные ~35 дней назад, поэтому окна старше месяца неполны — это
          // сказано в note метрик, а не спрятано.
          timed("feedbacks", loadAllPages<FeedbackNmRow>((start, end) => {
            let query = db
              .from("wb_feedbacks")
              .select("nm_id, rating, created_at_wb")
              .gte("created_at_wb", `${from}T00:00:00`)
              .lt("created_at_wb", `${nextIsoDate(to)}T00:00:00`)
              .order("created_at_wb", { ascending: true })
              .range(start, end);
            if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
            if (allowed) query = query.in("nm_id", allowed);
            return query;
          })).catch(() => [] as FeedbackNmRow[]),
          // Сплит рекламы по видам кампаний: тип живёт на кампании (wb_adverts),
          // дневная статистика — на кампании (wb_advert_stats). По SKU тип не
          // распределяется, поэтому эти ряды идут только в сводку.
          timed("advert_types", loadAllPages<AdvertTypeRow>((start, end) => {
            let query = db
              .from("wb_adverts")
              .select("advert_id, bid_type")
              .order("advert_id", { ascending: true })
              .range(start, end);
            if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
            return query as unknown as PromiseLike<PageResult<AdvertTypeRow>>;
          })).catch(() => [] as AdvertTypeRow[]),
          timed("advert_stats", loadAllPages<AdvertStatDayRow>((start, end) => {
            let query = db
              .from("wb_advert_stats")
              .select("advert_id, date, views, clicks, sum_spent, orders, sum_orders")
              .gte("date", from)
              .lte("date", to)
              .order("date", { ascending: true })
              .order("advert_id", { ascending: true })
              .range(start, end);
            if (scope.cabinetId) query = query.eq("cabinet_id", scope.cabinetId);
            return query as unknown as PromiseLike<PageResult<AdvertStatDayRow>>;
          })).catch(() => [] as AdvertStatDayRow[]),
          loadSalesReturns(db, scope, allowed, from, to),
          latestSourceDate("wb_orders", scope),
          latestSourceDate("wb_sales", scope),
          latestSyncStateDate(scope, "orders"),
          latestSyncStateDate(scope, "sales"),
          latestSyncStateDate(scope, "advert-stats"),
          latestSyncStateDate(scope, "funnel", { preferLastPeriodEnd: true }),
        ]);
        const ordersCutoff = latestKnownDate([ordersRowCutoff, ordersSyncCutoff]);
        const salesCutoff = latestKnownDate([salesRowCutoff, salesSyncCutoff]);
        const advertsCutoff = latestKnownDate([latestDate(adRows, (row) => row.date), advertsSyncCutoff]);
        const funnelCutoff = latestKnownDate([latestDate(funnelRows, (row) => row.date), funnelSyncCutoff]);
        return {
          skuRows: baseFacts.skuRows,
          totals: baseFacts.totals,
          adRows,
          funnelRows,
          feedbackRows,
          advertTypeRows,
          advertStatRows,
          returnRows,
          ordersCutoff,
          salesCutoff,
          advertsCutoff,
          funnelCutoff,
          // Отмены и цены знает только путь по первичным строкам заказов и продаж.
          // RPC-агрегат rnp_daily их не отдаёт, и подменять их нулём нельзя.
          hasPrimaryFacts: !!allowed,
          scope,
          asOf: earliestKnownDate([latestKnownDate([funnelCutoff, ordersCutoff]), salesCutoff], periodEnd),
        };
      })),
      loadAllPages<ProductCostRow>((start, end) => db
        .from("product_costs")
        .select("article, name, cost_rub, brand, category")
        .order("article", { ascending: true })
        .range(start, end)),
      getWbCommissionForCabinet(p_cabinet, 30, { allowLiveFallback: false }),
      // Бренд и предмет WB принадлежат карточке товара, а не кабинету.
      // Ошибка/лимит Content API не должны ломать сам РНП: в таком случае
      // ниже остаётся безопасный fallback на справочник себестоимости.
      //
      // Сначала пробуем прогретый снимок, а если его нет — идём за карточками
      // сами, но под секундомером. Прежде тут стоял только снимок, и когда он
      // не прогревался, «Бренд» и «Категория» в фильтрах оставались пустыми
      // навсегда: замер на Retail Family — 64 карточки за 1–2 секунды, а
      // фильтры не работали месяцами. Таймбокс держит прежнюю страховку от
      // 504: не успели — отдаём экран без карточек, снимок дойдёт в фоне.
      loadPimForRnp(p_cabinet),
    ]);

    const skuDailyRows = scopeData.flatMap((item) => applyRnpSourceCutoffs(
      applySalesReturnsAdjustment(
        applyFunnelOrdersOverlay(item.skuRows, item.funnelRows),
        item.returnRows,
      ),
      {
        orders: latestKnownDate([item.funnelCutoff, item.ordersCutoff]),
        sales: item.salesCutoff,
        adverts: item.advertsCutoff,
      },
    ));
    const totals = scopeData.flatMap((item) => item.totals);
    const adRows = scopeData.flatMap((item) => item.adRows.filter((row) => !item.advertsCutoff || String(row.date).slice(0, 10) <= item.advertsCutoff));
    const funnelRows = scopeData.flatMap((item) => item.funnelRows.filter((row) => !item.funnelCutoff || String(row.date).slice(0, 10) <= item.funnelCutoff));
    const feedbackRows = scopeData.flatMap((item) => item.feedbackRows);
    const advertTypeRows = scopeData.flatMap((item) => item.advertTypeRows);
    const advertStatRows = scopeData.flatMap((item) => item.advertStatRows.filter((row) => !item.advertsCutoff || String(row.date).slice(0, 10) <= item.advertsCutoff));
    // У каждого источника своя свежесть. Раньше весь РНП обрезался по min(orders, sales),
    // из-за чего задержка выкупов могла занижать уже загруженные заказы Optima.
    const ordersCutoff = latestKnownDate(scopeData.map((item) => latestKnownDate([item.funnelCutoff, item.ordersCutoff])));
    const salesCutoff = latestKnownDate(scopeData.map((item) => item.salesCutoff));
    const advertsCutoff = latestKnownDate(scopeData.map((item) => item.advertsCutoff));
    const funnelCutoff = latestKnownDate(scopeData.map((item) => item.funnelCutoff));
    let schemeFactsInSummary = true;
    const cutoffsByNm = new Map<number, MetricCutoffs>();
    const primaryFactsByNm = new Map<number, boolean>();
    const schemeFactsByNm = new Map<number, boolean>();
    for (const item of scopeData) {
      const cutoffs = { orders: latestKnownDate([item.funnelCutoff, item.ordersCutoff]), sales: item.salesCutoff, adverts: item.advertsCutoff };
      // Пустой кабинет схему не «теряет»: терять нечего, поэтому он не гасит метрику.
      const hasScheme = item.hasPrimaryFacts
        && (item.skuRows.length === 0 || item.skuRows.some((row) => row.orders_fbs_count !== undefined));
      for (const total of item.totals) {
        cutoffsByNm.set(Number(total.nm_id), cutoffs);
        primaryFactsByNm.set(Number(total.nm_id), item.hasPrimaryFacts);
        schemeFactsByNm.set(Number(total.nm_id), hasScheme);
      }
      if (!hasScheme) schemeFactsInSummary = false;
    }
    // Сводка складывает все кабинеты: если хотя бы один не отдаёт первичные факты,
    // общая цифра была бы занижена, поэтому такие метрики молчат целиком.
    const primaryFactsInSummary = scopeData.every((item) => item.hasPrimaryFacts);

    // рекламный и товарный трафик по (nm_id, date) — отдельно от rnp_daily(_sku) RPC
    const viewsByNm = new Map<number, Map<string, number>>();
    const clicksByNm = new Map<number, Map<string, number>>();
    const adOrdersByNm = new Map<number, Map<string, number>>();
    const adOrdersSumByNm = new Map<number, Map<string, number>>();
    const openCardByNm = new Map<number, Map<string, number>>();
    const cartByNm = new Map<number, Map<string, number>>();
    for (const r of adRows) {
      const d = String(r.date).slice(0, 10);
      if (!viewsByNm.has(r.nm_id)) {
        viewsByNm.set(r.nm_id, new Map());
        clicksByNm.set(r.nm_id, new Map());
        adOrdersByNm.set(r.nm_id, new Map());
        adOrdersSumByNm.set(r.nm_id, new Map());
      }
      viewsByNm.get(r.nm_id)!.set(d, (viewsByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.views ?? 0));
      clicksByNm.get(r.nm_id)!.set(d, (clicksByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.clicks ?? 0));
      adOrdersByNm.get(r.nm_id)!.set(d, (adOrdersByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.orders ?? 0));
      adOrdersSumByNm.get(r.nm_id)!.set(d, (adOrdersSumByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.orders_sum ?? 0));
    }
    const reviewsByNm = new Map<number, Map<string, { count: number; ratingSum: number; bad: number }>>();
    const reviewsByDateAll = new Map<string, { count: number; ratingSum: number; bad: number }>();
    for (const r of feedbackRows) {
      const d = String(r.created_at_wb ?? "").slice(0, 10);
      if (!d) continue;
      const rating = Number(r.rating ?? 0);
      if (!reviewsByNm.has(r.nm_id)) reviewsByNm.set(r.nm_id, new Map());
      const perNm = reviewsByNm.get(r.nm_id)!;
      const nmDay = perNm.get(d) ?? { count: 0, ratingSum: 0, bad: 0 };
      nmDay.count += 1;
      nmDay.ratingSum += rating;
      if (rating > 0 && rating <= 3) nmDay.bad += 1;
      perNm.set(d, nmDay);
      const allDay = reviewsByDateAll.get(d) ?? { count: 0, ratingSum: 0, bad: 0 };
      allDay.count += 1;
      allDay.ratingSum += rating;
      if (rating > 0 && rating <= 3) allDay.bad += 1;
      reviewsByDateAll.set(d, allDay);
    }
    const wishlistByNm = new Map<number, Map<string, number>>();
    for (const r of funnelRows) {
      const d = String(r.date).slice(0, 10);
      if (!openCardByNm.has(r.nm_id)) openCardByNm.set(r.nm_id, new Map());
      if (!cartByNm.has(r.nm_id)) cartByNm.set(r.nm_id, new Map());
      openCardByNm.get(r.nm_id)!.set(d, (openCardByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.open_card ?? 0));
      cartByNm.get(r.nm_id)!.set(d, (cartByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.add_to_cart ?? 0));
      // Избранное: null в строке — «неизвестно», день в карту не попадает.
      if (r.add_to_wishlist != null) {
        if (!wishlistByNm.has(r.nm_id)) wishlistByNm.set(r.nm_id, new Map());
        wishlistByNm.get(r.nm_id)!.set(d, (wishlistByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.add_to_wishlist));
      }
    }
    // агрегат по всем nm — для сводки строки
    const viewsByDateAll = new Map<string, number>();
    const clicksByDateAll = new Map<string, number>();
    const adOrdersByDateAll = new Map<string, number>();
    const adOrdersSumByDateAll = new Map<string, number>();
    const openCardByDateAll = new Map<string, number>();
    const cartByDateAll = new Map<string, number>();
    for (const r of adRows) {
      const d = String(r.date).slice(0, 10);
      viewsByDateAll.set(d, (viewsByDateAll.get(d) ?? 0) + Number(r.views ?? 0));
      clicksByDateAll.set(d, (clicksByDateAll.get(d) ?? 0) + Number(r.clicks ?? 0));
      adOrdersByDateAll.set(d, (adOrdersByDateAll.get(d) ?? 0) + Number(r.orders ?? 0));
      adOrdersSumByDateAll.set(d, (adOrdersSumByDateAll.get(d) ?? 0) + Number(r.orders_sum ?? 0));
    }
    const bidTypeByAdvert = new Map<number, string | null>();
    for (const row of advertTypeRows) bidTypeByAdvert.set(Number(row.advert_id), row.bid_type);
    const adTypeBuckets = new Map<string, Map<string, AdTypeDayBucket>>();
    let adTypeUnclassifiedSpent = 0;
    for (const row of advertStatRows) {
      const group = wbBidTypeGroup(bidTypeByAdvert.get(Number(row.advert_id)));
      const spent = Number(row.sum_spent ?? 0);
      if (!group) {
        adTypeUnclassifiedSpent += spent;
        continue;
      }
      const day = String(row.date).slice(0, 10);
      if (!adTypeBuckets.has(group)) adTypeBuckets.set(group, new Map());
      const perDay = adTypeBuckets.get(group)!;
      const bucket = perDay.get(day) ?? { spent: 0, views: 0, clicks: 0, orders: 0, ordersSum: 0 };
      bucket.spent += spent;
      bucket.views += Number(row.views ?? 0);
      bucket.clicks += Number(row.clicks ?? 0);
      bucket.orders += Number(row.orders ?? 0);
      bucket.ordersSum += Number(row.sum_orders ?? 0);
      perDay.set(day, bucket);
    }
    const wishlistByDateAll = new Map<string, number>();
    for (const r of funnelRows) {
      const d = String(r.date).slice(0, 10);
      openCardByDateAll.set(d, (openCardByDateAll.get(d) ?? 0) + Number(r.open_card ?? 0));
      cartByDateAll.set(d, (cartByDateAll.get(d) ?? 0) + Number(r.add_to_cart ?? 0));
      if (r.add_to_wishlist != null) wishlistByDateAll.set(d, (wishlistByDateAll.get(d) ?? 0) + Number(r.add_to_wishlist));
    }
    // полный расход МП на nm = комиссия + эквайринг + прочие удержания (логистика/хранение/штрафы/…) + account-overhead
    const wbCostForNm = (nm: number) => {
      const rates = resolveWbRatesForNm(comm, nm);
      return rates.factual ? rates.marketplacePct + rates.acquiringPct : null;
    };
    // Те же ставки, но по статьям: marketplacePct = комиссия + прочие + overhead,
    // поэтому для разбивки берём слагаемые, а не готовую сумму.
    const wbRatesForNm = (nm: number) => {
      const rates = resolveWbRatesForNm(comm, nm);
      if (!rates.factual) return null;
      return {
        commissionPct: rates.commissionPct,
        acquiringPct: rates.acquiringPct,
        extraPct: rates.extraPct,
        overheadPct: rates.overheadPct,
        extraParts: rates.extraParts,
      };
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
      addOptionalFacts(current, r);
      dailyByDate.set(date, current);
    }

    const costByArt = new Map(costs.map((cost) => [cost.article, cost]));
    const pimCold = catalog === "cold";
    const cards = pimCold ? [] : catalog;
    const cardByNm = new Map(cards.map((card) => [card.nmId, card]));
    const totalByNm = new Map<number, RpcTotal>();
    for (const total of totals) {
      const existing = totalByNm.get(total.nm_id);
      totalByNm.set(total.nm_id, existing ? {
        nm_id: total.nm_id,
        article: existing.article || total.article,
        stock: Number(existing.stock ?? 0) + Number(total.stock ?? 0),
        in_way_to_client: Number(existing.in_way_to_client ?? 0) + Number(total.in_way_to_client ?? 0),
        in_way_from_client: Number(existing.in_way_from_client ?? 0) + Number(total.in_way_from_client ?? 0),
        cost: existing.cost ?? total.cost,
      } : total);
    }
    // Каталог даёт артикул и сохраняет в РНП новые/нулевые SKU, которых ещё нет
    // в фактах периода и текущих остатках. Это намного дешевле 30-дневного
    // rnp_report и уже загружается выше через часовой PIM-кэш.
    for (const card of cards) {
      const existing = totalByNm.get(card.nmId);
      totalByNm.set(card.nmId, existing ? {
        ...existing,
        article: existing.article || card.article || "",
      } : {
        nm_id: card.nmId,
        article: card.article || "",
        ...EMPTY_STOCK_POSITION,
        cost: null,
      });
    }
    for (const [nmId, total] of totalByNm) {
      const article = total.article || cardByNm.get(nmId)?.article || "";
      totalByNm.set(nmId, {
        ...total,
        article,
        cost: total.cost ?? (article ? (costByArt.get(article)?.cost_rub ?? null) : null),
      });
    }
    const stockTotal = [...totalByNm.values()].reduce((sum, row) => sum + Number(row.stock ?? 0), 0);
    const stockMoneyTotal = [...totalByNm.values()].reduce((sum, row) => sum + Number(row.stock ?? 0) * Number(row.cost ?? 0), 0);
    const inWayToClientTotal = [...totalByNm.values()].reduce((sum, row) => sum + Number(row.in_way_to_client ?? 0), 0);
    const inWayFromClientTotal = [...totalByNm.values()].reduce((sum, row) => sum + Number(row.in_way_from_client ?? 0), 0);
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
      addOptionalFacts(current, row);
      dateMap.set(date, current);
      byNm.set(row.nm_id, dateMap);
    }

    // Баскет фото проверяется у WB по томам (обычно 3-5 на кабинет), а не вычисляется
    // формулой: та протухает при каждой новой разрезке и даёт пустые миниатюры.
    const imageByNm = await wbCardImageUrlsByNmIds([...totalByNm.keys()]).catch(() => new Map<number, string>());
    const skus = [...totalByNm.values()]
      .map((t) => {
        const dmap = byNm.get(t.nm_id) ?? new Map<string, DailyRow>();
        const card = cardByNm.get(t.nm_id);
        const cost = costByArt.get(t.article);
        const metrics = buildMetrics(days, asOf, dmap, Number(t.stock ?? 0), Math.round(Number(t.stock ?? 0) * Number(t.cost ?? 0)), cutoffsByNm.get(t.nm_id) ?? metricCutoffs, Number(t.cost ?? 0), wbCostForNm(t.nm_id), turnoverWindowDays, { primaryFacts: primaryFactsByNm.get(t.nm_id) ?? primaryFactsInSummary, schemeFacts: schemeFactsByNm.get(t.nm_id) ?? schemeFactsInSummary, inWayToClient: Number(t.in_way_to_client ?? 0), inWayFromClient: Number(t.in_way_from_client ?? 0), rates: wbRatesForNm(t.nm_id) });
        metrics.unshift(...buildFunnelMetrics(days, asOf, viewsByNm.get(t.nm_id) ?? new Map(), clicksByNm.get(t.nm_id) ?? new Map(), openCardByNm.get(t.nm_id) ?? new Map(), cartByNm.get(t.nm_id) ?? new Map(), funnelCutoffs, {
          ordersByDate: adOrdersByNm.get(t.nm_id) ?? new Map(),
          ordersSumByDate: adOrdersSumByNm.get(t.nm_id) ?? new Map(),
        }, wishlistByNm.get(t.nm_id) ?? new Map()));
        appendOrderConversion(metrics);
        appendOrganicMetrics(metrics);
        metrics.push(...buildReviewMetrics(days, asOf, reviewsByNm.get(t.nm_id) ?? new Map()));
        const orders = metrics.find((m) => m.field === "orders_count")?.total ?? 0;
        return {
          nm: t.nm_id,
          art: t.article || card?.article || String(t.nm_id),
          name: card?.name || cost?.name || t.article || String(t.nm_id),
          brand: card?.brand || cost?.brand || "",
          subject: card?.subject || cost?.category || "",
          img_url: imageByNm.get(t.nm_id) ?? wbCardImageUrl(t.nm_id),
          metrics,
          _o: orders,
        };
      })
      .sort((a, b) => b._o - a._o)
      .map(({ _o, ...rest }) => { void _o; return rest; });

    // Сводка: базовые метрики из дневной агрегации + Валовая/Маржа вклеиваем суммой по SKU (себес разный)
    const summary = buildMetrics(days, asOf, dailyByDate, stockTotal, Math.round(stockMoneyTotal), metricCutoffs, 0, null, turnoverWindowDays, { primaryFacts: primaryFactsInSummary, schemeFacts: schemeFactsInSummary, inWayToClient: inWayToClientTotal, inWayFromClient: inWayFromClientTotal });
    summary.unshift(...buildFunnelMetrics(days, asOf, viewsByDateAll, clicksByDateAll, openCardByDateAll, cartByDateAll, funnelCutoffs, {
      ordersByDate: adOrdersByDateAll,
      ordersSumByDate: adOrdersSumByDateAll,
    }, wishlistByDateAll));
    appendOrderConversion(summary);
    appendOrganicMetrics(summary);
    summary.push(...buildReviewMetrics(days, asOf, reviewsByDateAll));
    summary.push(...buildAdTypeMetrics(days, asOf, adTypeBuckets, adTypeUnclassifiedSpent, advertsCutoff));
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
    // Экономика сводки складывается по SKU: себестоимость и ставки WB у каждого свои,
    // общей ставки для всего кабинета не существует.
    for (const field of ["cogs", "commission_rub", "acquiring_rub", "logistics_rub", "mp_cost_rub"]) {
      const metric = summary.find((item) => item.field === field);
      if (!metric) continue;
      const daily = sumDaily(field);
      const total = knownSum(daily);
      Object.assign(metric, { daily, total: total == null ? null : Math.round(total), forecast: null });
    }
    const summaryTotal = (field: string) => summary.find((item) => item.field === field)?.total ?? null;
    const summaryBuyoutsCount = summaryTotal("buyouts_count");
    const summaryAdSpend = summaryTotal("ad_spent");
    const profitPerUnitMetric = summary.find((item) => item.field === "profit_per_unit");
    if (profitPerUnitMetric) Object.assign(profitPerUnitMetric, {
      daily: days.map((_, index) => {
        const gross = grossDaily[index];
        const buyouts = summary.find((item) => item.field === "buyouts_count")?.daily[index];
        return gross != null && buyouts != null && buyouts > 0 ? Math.round(gross / buyouts) : null;
      }),
      total: grossTotal != null && summaryBuyoutsCount != null && summaryBuyoutsCount > 0
        ? Math.round(grossTotal / summaryBuyoutsCount)
        : null,
      forecast: null,
    });
    const romiMetric = summary.find((item) => item.field === "romi");
    if (romiMetric) Object.assign(romiMetric, {
      daily: days.map((_, index) => {
        const gross = grossDaily[index];
        const ads = summary.find((item) => item.field === "ad_spent")?.daily[index];
        return gross != null && ads != null && ads > 0 ? Math.round((gross / ads) * 1000) / 10 : null;
      }),
      total: grossTotal != null && summaryAdSpend != null && summaryAdSpend > 0
        ? Math.round((grossTotal / summaryAdSpend) * 1000) / 10
        : null,
      forecast: null,
    });
    applyMetricForecasts(summary, days, asOf);
    // Повторный проход прогнозов сбросил бы покрытие производных долей на 100%.
    applyDerivedRatioCoverage(summary, "cancel_pct", ["cancels_count", "orders_count"]);
    applyDerivedRatioCoverage(summary, "return_pct", ["returns_count", "buyouts_count"]);
    applyDerivedRatioCoverage(summary, "fbs_share_pct", ["orders_fbs_sum", "orders_fbw_sum"]);
    applyDerivedRatioCoverage(summary, "actual_buyout_pct", ["buyouts_count", "returns_count"]);
    applyDerivedRatioCoverage(summary, "orders_spp_sum", ["orders_sum", "buyouts_sum"]);
    applyDerivedRatioCoverage(summary, "buyouts_gross_count", ["buyouts_count", "returns_count"]);
    applyDerivedRatioCoverage(summary, "avg_order_price", ["orders_sum", "orders_count"]);
    applyDerivedRatioCoverage(summary, "seller_discount_pct", ["orders_sum"]);
    applyDerivedRatioCoverage(summary, "avg_buyout_price", ["buyouts_sum", "buyouts_count"]);
    applyDerivedRatioCoverage(summary, "final_price", ["buyouts_count", "returns_count"]);
    applyDerivedRatioCoverage(summary, "spp_pct", ["buyouts_sum"]);
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
    const economyCoverageFields = [
      "gross", "margin_pct", "money", "gmroi",
      ...EMPTY_ECONOMY_FIELDS.map((item) => item.field),
    ];
    for (const metric of summary.filter((item) => economyCoverageFields.includes(item.field))) {
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
      ...(pimCold ? { pim_cold: true } : {}),
      timings,
      generated_at: new Date().toISOString(),
      as_of: asOf,
      scope_freshness: scopeData.map((item) => ({
        cabinet_id: item.scope.cabinetId,
        label: item.scope.label,
        as_of: item.asOf,
        orders_as_of: latestKnownDate([item.funnelCutoff, item.ordersCutoff]),
        sales_as_of: item.salesCutoff,
        adverts_as_of: item.advertsCutoff,
        funnel_as_of: item.funnelCutoff,
      })),
      forecast_note: "Прогноз использует факт каждого кабинета только до его последней полной даты, профиль дня недели и краткосрочный тренд. Заказы сверяются с WB Analytics → Этапы воронки продаж, WB Статистика остаётся fallback. Календарь акций WB пока не подключён.",
      period,
      summary,
      skus,
    };
  } catch (error) {
    // Тайминги нужнее всего именно при падении: снимок не собрался, и без них
    // «statement timeout» не говорит, какой из источников встал.
    const measured = Object.entries(timings)
      .sort((a, b) => b[1] - a[1])
      .map(([name, ms]) => `${name} ${ms}мс`)
      .join(", ");
    const reason = error instanceof Error ? error.message : "Не удалось собрать РНП";
    return { error: measured ? `${reason} | ${measured}` : reason };
  }
}
