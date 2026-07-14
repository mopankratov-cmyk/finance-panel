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
import { getWbCommissionForCabinet } from "@/lib/wb/commissions";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { requestAllowedNmIds } from "@/lib/wb/requestProductScope";

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
interface FunnelCartRow { nm_id: number; date: string; add_to_cart: number | null }
interface ProductCostRow { article: string; name: string | null }
interface CabinetScope { cabinetId: string | null; allowedNmIds: Set<number> | null }
interface MetricCutoffs { orders: string | null; sales: string | null; adverts: string | null }
interface FunnelCutoffs { adverts: string | null; funnel: string | null }

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

// Показы/клики/CTR/корзины по SKU по дням — отдельный источник (wb_advert_nm_daily +
// wb_funnel_daily), не трогаем rnp_daily(_sku) RPC (общий для многих потребителей).
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
  group_start?: boolean;
}

const ADDITIVE_FORECAST_FIELDS = new Set([
  "views",
  "clicks",
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

function applyMetricForecasts(metrics: Metric[], days: string[], asOf: string) {
  const results = new Map<string, RnpMetricForecast | null>();
  for (const metric of metrics) {
    if (!ADDITIVE_FORECAST_FIELDS.has(metric.field)) continue;
    const result = forecastAdditiveMetric(days, metric.daily, asOf);
    results.set(metric.field, result);
    applyForecast(metric, result, days, asOf);
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
  return metrics;
}

function knownSum(values: (number | null)[]) {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function buildFunnelMetrics(
  days: string[],
  asOf: string,
  viewsByDate: Map<string, number>,
  clicksByDate: Map<string, number>,
  cartByDate: Map<string, number>,
  cutoffs: FunnelCutoffs,
): Metric[] {
  const read = (source: Map<string, number>, day: string, cutoff: string | null) =>
    !cutoff || day > asOf || day > cutoff ? null : Number(source.get(day) ?? 0);
  const views = days.map((day) => read(viewsByDate, day, cutoffs.adverts));
  const clicks = days.map((day) => read(clicksByDate, day, cutoffs.adverts));
  const cart = days.map((day) => read(cartByDate, day, cutoffs.funnel));
  const ctr = days.map((_, index) => Number(views[index]) > 0 && clicks[index] != null
    ? Math.round((Number(clicks[index]) / Number(views[index])) * 1000) / 10
    : null);
  const totalViews = knownSum(views);
  const totalClicks = knownSum(clicks);
  const metrics: Metric[] = [
    { field: "views", label: "Показы", kind: "int", daily: views, total: totalViews, forecast: null, source: "WB Реклама", group_start: true },
    { field: "clicks", label: "Клики", kind: "int", daily: clicks, total: totalClicks, forecast: null, source: "WB Реклама" },
    { field: "ctr", label: "CTR, %", kind: "pct", daily: ctr, total: totalViews && totalClicks != null ? Math.round((totalClicks / totalViews) * 1000) / 10 : null, forecast: null, source: "WB Реклама", note: "Клики / показы. Пустые даты источника не считаются нулём." },
    { field: "cart", label: "В корзину", kind: "int", daily: cart, total: knownSum(cart), forecast: null, source: "WB Воронка" },
  ];
  return applyMetricForecasts(metrics, days, asOf);
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
  wbCostPct = 0,
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
    { field: "orders_count", label: "Заказы, шт", kind: "int", daily: ordersCount, total: totalOrdersCount, forecast: null, source: "WB Статистика", group_start: true },
    { field: "orders_sum", label: "Заказы, ₽", kind: "money", daily: ordersSum, total: totalOrdersSum == null ? null : Math.round(totalOrdersSum), forecast: null, source: "WB Статистика" },
    { field: "buyouts_count", label: "Выкупы, шт", kind: "int", daily: buyoutsCount, total: totalBuyoutsCount, forecast: null, source: "WB Статистика", group_start: true },
    { field: "buyouts_sum", label: "Выкупы, ₽", kind: "money", daily: buyoutsSum, total: totalBuyoutsSum == null ? null : Math.round(totalBuyoutsSum), forecast: null, source: "WB Статистика" },
    {
      field: "buyout_pct",
      label: "Выкуп потока, %",
      kind: "pct",
      daily: buyoutPct,
      total: totalOrdersCount != null && totalBuyoutsCount != null && totalOrdersCount > 0 ? r1((totalBuyoutsCount / totalOrdersCount) * 100) : null,
      forecast: null,
      source: "WB Статистика",
      note: "Календарные заказы и выкупы относятся к разным когортам, поэтому дневное значение может превышать 100%.",
    },
    { field: "ad_spent", label: "Реклама, ₽", kind: "money", daily: adSpend, total: totalAdSpend == null ? null : Math.round(totalAdSpend), forecast: null, source: "WB Реклама", group_start: true },
    { field: "drr", label: "ДРР к заказам, %", kind: "pct", daily: drr, total: totalOrdersSum != null && totalAdSpend != null && totalOrdersSum > 0 ? r1((totalAdSpend / totalOrdersSum) * 100) : null, forecast: null, source: "WB Реклама + WB Статистика", note: "Рекламный расход / сумма заказов календарного периода." },
  ];
  let grossTotalForGmroi: number | null = null;
  if (cost > 0) {
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
  }
  // Оборачиваемость, дней = остаток / (выкупы в день). GMROI % = валовая / деньги в остатках.
  const observedDays = buyoutsCount.filter((value) => value != null).length;
  const dailyBuyouts = observedDays > 0 && totalBuyoutsCount != null ? totalBuyoutsCount / observedDays : 0;
  const turnover = dailyBuyouts > 0 ? Math.round(stock / dailyBuyouts) : null;
  const gmroi = grossTotalForGmroi != null && stockMoney > 0 ? r1(Math.min(999, (grossTotalForGmroi / stockMoney) * 100)) : null;
  const knownStockMoney = stockMoney > 0 || stock === 0 ? Math.round(stockMoney) : null;
  out.push(
    { field: "stock", label: "Остаток, шт", kind: "int", daily: days.map(() => null), total: stock, forecast: null, source: "WB Остатки", group_start: true },
    { field: "money", label: "Деньги в остатках, ₽", kind: "money", daily: days.map(() => null), total: knownStockMoney, forecast: null, source: "WB Остатки + себестоимость" },
    { field: "turnover", label: "Оборачиваемость, дней", kind: "int", daily: days.map(() => null), total: turnover, forecast: null, source: "WB Остатки + выкупы" },
    { field: "gmroi", label: "GMROI, %", kind: "pct", daily: days.map(() => null), total: gmroi, forecast: null, source: "Расчётная прибыль / деньги в остатках" },
  );
  return applyMetricForecasts(out, days, asOf);
}

export interface RnpTable {
  shop_label: string;
  sku_count: number;
  generated_at: string;
  as_of: string;
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

function minimumDate(values: Array<string | null | undefined>): string | null {
  const known = values.filter((value): value is string => !!value);
  return known.length ? known.reduce((earliest, value) => value < earliest ? value : earliest) : null;
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
    scopes = [{ cabinetId: p_cabinet, allowedNmIds: await requestAllowedNmIds(p_cabinet) }];
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
    const [scopeData, costs, comm] = await Promise.all([
      Promise.all(scopes.map(async (scope) => {
        if (scope.allowedNmIds?.size === 0) {
          return {
            skuRows: [] as SkuDailyRow[],
            totals: [] as RpcTotal[],
            adRows: [] as AdNmRow[],
            funnelRows: [] as FunnelCartRow[],
            ordersCutoff: null as string | null,
            salesCutoff: null as string | null,
          };
        }
        const allowed = scope.allowedNmIds ? [...scope.allowedNmIds] : null;
        const [skuRows, totals, adRows, funnelRows, ordersCutoff, salesCutoff] = await Promise.all([
          loadAllPages<SkuDailyRow>((start, end) => {
            let query = db
              .rpc("rnp_daily_sku", { p_from: from, p_to: to, p_cabinet: scope.cabinetId })
              .order("d", { ascending: true })
              .order("nm_id", { ascending: true })
              .range(start, end);
            if (allowed) query = query.in("nm_id", allowed);
            return query;
          }),
          loadAllPages<RpcTotal>((start, end) => {
            let query = db
              .rpc("rnp_report", { p_cabinet: scope.cabinetId })
              .order("nm_id", { ascending: true })
              .range(start, end);
            if (allowed) query = query.in("nm_id", allowed);
            return query;
          }),
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
          loadAllPages<FunnelCartRow>((start, end) => {
            let query = db
              .from("wb_funnel_daily")
              .select("nm_id, date, add_to_cart")
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
        return { skuRows, totals, adRows, funnelRows, ordersCutoff, salesCutoff };
      })),
      loadAllPages<ProductCostRow>((start, end) => db
        .from("product_costs")
        .select("article, name")
        .order("article", { ascending: true })
        .range(start, end)),
      getWbCommissionForCabinet(p_cabinet, 30),
    ]);

    const skuDailyRows = scopeData.flatMap((item) => item.skuRows);
    const totals = scopeData.flatMap((item) => item.totals);
    const adRows = scopeData.flatMap((item) => item.adRows);
    const funnelRows = scopeData.flatMap((item) => item.funnelRows);
    const ordersCutoff = minimumDate(scopeData.map((item) => item.ordersCutoff));
    const salesCutoff = minimumDate(scopeData.map((item) => item.salesCutoff));
    const advertsCutoff = minimumDate(scopeData.map((item) => latestDate(item.adRows, (row) => row.date)));
    const funnelCutoff = minimumDate(scopeData.map((item) => latestDate(item.funnelRows, (row) => row.date)));

    // показы/клики/корзины по (nm_id, date) — отдельно от rnp_daily(_sku) RPC
    const viewsByNm = new Map<number, Map<string, number>>();
    const clicksByNm = new Map<number, Map<string, number>>();
    const cartByNm = new Map<number, Map<string, number>>();
    for (const r of adRows) {
      const d = String(r.date).slice(0, 10);
      if (!viewsByNm.has(r.nm_id)) { viewsByNm.set(r.nm_id, new Map()); clicksByNm.set(r.nm_id, new Map()); }
      viewsByNm.get(r.nm_id)!.set(d, (viewsByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.views ?? 0));
      clicksByNm.get(r.nm_id)!.set(d, (clicksByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.clicks ?? 0));
    }
    for (const r of funnelRows) {
      const d = String(r.date).slice(0, 10);
      if (!cartByNm.has(r.nm_id)) cartByNm.set(r.nm_id, new Map());
      cartByNm.get(r.nm_id)!.set(d, (cartByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.add_to_cart ?? 0));
    }
    // агрегат по всем nm — для сводки строки
    const viewsByDateAll = new Map<string, number>(), clicksByDateAll = new Map<string, number>(), cartByDateAll = new Map<string, number>();
    for (const r of adRows) {
      const d = String(r.date).slice(0, 10);
      viewsByDateAll.set(d, (viewsByDateAll.get(d) ?? 0) + Number(r.views ?? 0));
      clicksByDateAll.set(d, (clicksByDateAll.get(d) ?? 0) + Number(r.clicks ?? 0));
    }
    for (const r of funnelRows) {
      const d = String(r.date).slice(0, 10);
      cartByDateAll.set(d, (cartByDateAll.get(d) ?? 0) + Number(r.add_to_cart ?? 0));
    }
    // полный расход МП на nm = комиссия + эквайринг + прочие удержания (логистика/хранение/штрафы/…) + account-overhead
    const wbCostForNm = (nm: number) => {
      const e = comm.byNm.get(nm);
      return (e?.pct ?? comm.avgPct) + (e?.acqPct ?? comm.avgAcqPct) + (e?.extraPct ?? comm.avgExtraPct) + comm.overheadPct;
    };

    const days: string[] = [];
    const cur = new Date(from), end = new Date(to);
    while (cur <= end) { days.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
    const periodEnd = to < currentMoscowDate() ? to : currentMoscowDate();
    const asOf = earliestKnownDate([ordersCutoff, salesCutoff], periodEnd);
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
        const metrics = buildMetrics(days, asOf, dmap, Number(t.stock ?? 0), Math.round(Number(t.stock ?? 0) * Number(t.cost ?? 0)), metricCutoffs, Number(t.cost ?? 0), wbCostForNm(t.nm_id));
        metrics.unshift(...buildFunnelMetrics(days, asOf, viewsByNm.get(t.nm_id) ?? new Map(), clicksByNm.get(t.nm_id) ?? new Map(), cartByNm.get(t.nm_id) ?? new Map(), funnelCutoffs));
        const orders = metrics.find((m) => m.field === "orders_count")?.total ?? 0;
        return { nm: t.nm_id, art: t.article || String(t.nm_id), name: nameByArt.get(t.article) || t.article || String(t.nm_id), img_url: wbCardImageUrl(t.nm_id), metrics, _o: orders };
      })
      .sort((a, b) => b._o - a._o)
      .map(({ _o, ...rest }) => { void _o; return rest; });

    // Сводка: базовые метрики из дневной агрегации + Валовая/Маржа вклеиваем суммой по SKU (себес разный)
    const summary = buildMetrics(days, asOf, dailyByDate, stockTotal, Math.round(stockMoneyTotal), metricCutoffs);
    summary.unshift(...buildFunnelMetrics(days, asOf, viewsByDateAll, clicksByDateAll, cartByDateAll, funnelCutoffs));
    const sumDaily = (field: string) => days.map((_, i) => {
      let acc = 0, any = false;
      for (const sk of skus) { const m = sk.metrics.find((x) => x.field === field); const v = m?.daily[i]; if (v != null) { acc += Number(v); any = true; } }
      return any ? Math.round(acc) : null;
    });
    const grossDaily = sumDaily("gross");
    const costedSkus = skus.filter((sku) => sku.metrics.some((metric) => metric.field === "gross" && metric.total != null));
    const costedSkuCount = costedSkus.length;
    const economyCoveragePct = skus.length ? Math.round(costedSkuCount / skus.length * 1_000) / 10 : 0;
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
    const adIdx = summary.findIndex((m) => m.field === "drr");
    summary.splice(adIdx + 1, 0,
      { field: "gross", label: "Прибыль после расходов МП, ₽", kind: "money", daily: grossDaily, total: grossTotal == null ? null : Math.round(grossTotal), forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама", group_start: true },
      { field: "margin_pct", label: "Расчётная маржа после рекламы, %", kind: "pct", daily: days.map((day, i) => { const buyouts = Number(costedBuyoutsSumDaily[i] ?? 0); const gross = grossDaily[i]; return day <= asOf && buyouts > 0 && gross != null ? Math.round((gross / buyouts) * 1000) / 10 : null; }), total: grossTotal != null && costedBuyoutsSumTotal != null && costedBuyoutsSumTotal > 0 ? Math.round((grossTotal / costedBuyoutsSumTotal) * 1000) / 10 : null, forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама" },
    );
    applyMetricForecasts(summary, days, asOf);
    const marginMetric = summary.find((metric) => metric.field === "margin_pct");
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
    if (gmroiM) gmroiM.total = costedSkuCount && grossTotal != null && stockMoneyTotal > 0 ? Math.round(Math.min(999, (grossTotal / stockMoneyTotal) * 100) * 10) / 10 : null;
    for (const metric of summary.filter((item) => ["gross", "margin_pct", "money", "gmroi"].includes(item.field))) {
      metric.coveragePct = Math.min(metric.coveragePct ?? 100, economyCoveragePct);
      metric.status = statusForCoverage(metric.coveragePct);
      metric.note = [metric.note, `Себестоимость известна для ${costedSkuCount} из ${skus.length} SKU.`].filter(Boolean).join(" ");
      if (metric.forecastConfidencePct != null) {
        metric.forecastConfidencePct = Math.min(metric.forecastConfidencePct, Math.round(economyCoveragePct));
      }
    }

    return {
      shop_label: shopLabel || "Все кабинеты",
      sku_count: skus.length,
      generated_at: new Date().toISOString(),
      as_of: asOf,
      forecast_note: "Прогноз использует факт, профиль дня недели и краткосрочный тренд. Незаполненный хвост каждого источника исключается из факта; календарь акций WB пока не подключён.",
      period,
      summary,
      skus,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось собрать РНП" };
  }
}
