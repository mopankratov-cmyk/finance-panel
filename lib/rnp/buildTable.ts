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
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

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

function buildFunnelMetrics(days: string[], asOf: string, viewsByDate: Map<string, number>, clicksByDate: Map<string, number>, cartByDate: Map<string, number>): Metric[] {
  const read = (source: Map<string, number>, day: string) => day > asOf || !source.has(day) ? null : Number(source.get(day));
  const views = days.map((day) => read(viewsByDate, day));
  const clicks = days.map((day) => read(clicksByDate, day));
  const cart = days.map((day) => read(cartByDate, day));
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
function buildMetrics(days: string[], asOf: string, byDate: Map<string, DailyRow>, stock: number, stockMoney: number, cost = 0, wbCostPct = 0): Metric[] {
  const pick = (key: keyof DailyRow) => days.map((day) => day > asOf ? null : Number(byDate.get(day)?.[key] ?? 0));
  const r1 = (value: number) => Math.round(value * 10) / 10;
  const valueAt = (values: (number | null)[], index: number) => Number(values[index] ?? 0);
  const totalOf = (values: (number | null)[]) => knownSum(values) ?? 0;
  const ordersCount = pick("orders_count");
  const ordersSum = pick("orders_sum");
  const buyoutsCount = pick("buyouts_count");
  const buyoutsSum = pick("buyouts_sum");
  const adSpend = pick("ad_spent");
  const drr = days.map((day, index) => day > asOf
    ? null
    : valueAt(ordersSum, index) > 0
      ? r1((valueAt(adSpend, index) / valueAt(ordersSum, index)) * 100)
      : null);
  const buyoutPct = days.map((day, index) => day > asOf
    ? null
    : valueAt(ordersCount, index) > 0
      ? r1((valueAt(buyoutsCount, index) / valueAt(ordersCount, index)) * 100)
      : null);
  const totalOrdersSum = totalOf(ordersSum);
  const totalBuyoutsCount = totalOf(buyoutsCount);
  const totalOrdersCount = totalOf(ordersCount);
  const totalBuyoutsSum = totalOf(buyoutsSum);
  const totalAdSpend = totalOf(adSpend);
  const out: Metric[] = [
    { field: "orders_count", label: "Заказы, шт", kind: "int", daily: ordersCount, total: totalOrdersCount, forecast: null, source: "WB Статистика", group_start: true },
    { field: "orders_sum", label: "Заказы, ₽", kind: "money", daily: ordersSum, total: Math.round(totalOrdersSum), forecast: null, source: "WB Статистика" },
    { field: "buyouts_count", label: "Выкупы, шт", kind: "int", daily: buyoutsCount, total: totalBuyoutsCount, forecast: null, source: "WB Статистика", group_start: true },
    { field: "buyouts_sum", label: "Выкупы, ₽", kind: "money", daily: buyoutsSum, total: Math.round(totalBuyoutsSum), forecast: null, source: "WB Статистика" },
    {
      field: "buyout_pct",
      label: "Выкуп потока, %",
      kind: "pct",
      daily: buyoutPct,
      total: totalOrdersCount > 0 ? r1((totalBuyoutsCount / totalOrdersCount) * 100) : null,
      forecast: null,
      source: "WB Статистика",
      note: "Календарные заказы и выкупы относятся к разным когортам, поэтому дневное значение может превышать 100%.",
    },
    { field: "ad_spent", label: "Реклама, ₽", kind: "money", daily: adSpend, total: Math.round(totalAdSpend), forecast: null, source: "WB Реклама", group_start: true },
    { field: "drr", label: "ДРР к заказам, %", kind: "pct", daily: drr, total: totalOrdersSum > 0 ? r1((totalAdSpend / totalOrdersSum) * 100) : null, forecast: null, source: "WB Реклама + WB Статистика", note: "Рекламный расход / сумма заказов календарного периода." },
  ];
  let grossTotalForGmroi: number | null = null;
  if (cost > 0) {
    // Маржа после ВСЕХ расходов МП: выкупы₽ − себес×выкупы − wbCost%(комиссия+эквайринг+логистика+
    // хранение+штрафы+приёмка+прочие) − реклама. Всё из ФАКТ-финотчёта. Маржа % = это / выкупы₽.
    const marketplaceCost = wbCostPct / 100;
    const gross = days.map((day, index) => day > asOf
      ? null
      : Math.round(
        valueAt(buyoutsSum, index)
        - cost * valueAt(buyoutsCount, index)
        - valueAt(buyoutsSum, index) * marketplaceCost
        - valueAt(adSpend, index),
      ));
    const totalGross = totalBuyoutsSum - cost * totalBuyoutsCount - totalBuyoutsSum * marketplaceCost - totalAdSpend;
    grossTotalForGmroi = totalGross;
    const marginPct = days.map((day, index) => day > asOf
      ? null
      : valueAt(buyoutsSum, index) > 0
        ? r1((Number(gross[index]) / valueAt(buyoutsSum, index)) * 100)
        : null);
    out.push(
      { field: "gross", label: "Прибыль после расходов МП, ₽", kind: "money", daily: gross, total: Math.round(totalGross), forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама", group_start: true },
      { field: "margin_pct", label: "Расчётная маржа после рекламы, %", kind: "pct", daily: marginPct, total: totalBuyoutsSum > 0 ? r1((totalGross / totalBuyoutsSum) * 100) : null, forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама" },
    );
  }
  // Оборачиваемость, дней = остаток / (выкупы в день). GMROI % = валовая / деньги в остатках.
  const observedDays = days.filter((day) => day <= asOf).length;
  const dailyBuyouts = observedDays > 0 ? totalBuyoutsCount / observedDays : 0;
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

export async function buildRnpTable(from: string, to: string, cabinetId?: string | null, shopLabel?: string): Promise<RnpTable | { error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { error: "Supabase не настроен" };

  const p_cabinet = cabinetId || null; // null = все кабинеты
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);
  let adQ = db.from("wb_advert_nm_daily").select("nm_id, date, views, clicks").gte("date", from).lte("date", to);
  let funnelQ = db.from("wb_funnel_daily").select("nm_id, date, add_to_cart").gte("date", from).lte("date", to);
  if (p_cabinet) { adQ = adQ.eq("cabinet_id", p_cabinet); funnelQ = funnelQ.eq("cabinet_id", p_cabinet); }
  if (allowedNmIds) {
    const nmIds = allowedNmIds.size ? [...allowedNmIds] : [-1];
    adQ = adQ.in("nm_id", nmIds);
    funnelQ = funnelQ.in("nm_id", nmIds);
  }
  const [dailyRes, skuRes, totalsRes, costsRes, comm, adRes, funnelRes] = await Promise.all([
    db.rpc("rnp_daily", { p_from: from, p_to: to, p_cabinet }),
    db.rpc("rnp_daily_sku", { p_from: from, p_to: to, p_cabinet }),
    db.rpc("rnp_report", { p_cabinet }),
    db.from("product_costs").select("article, name"),
    getWbCommissionForCabinet(p_cabinet, 30),
    adQ,
    funnelQ,
  ]);
  if (dailyRes.error) return { error: dailyRes.error.message };

  // показы/клики/корзины по (nm_id, date) — отдельно от rnp_daily(_sku) RPC
  const viewsByNm = new Map<number, Map<string, number>>();
  const clicksByNm = new Map<number, Map<string, number>>();
  const cartByNm = new Map<number, Map<string, number>>();
  for (const r of (adRes.data ?? []) as AdNmRow[]) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const d = String(r.date).slice(0, 10);
    if (!viewsByNm.has(r.nm_id)) { viewsByNm.set(r.nm_id, new Map()); clicksByNm.set(r.nm_id, new Map()); }
    viewsByNm.get(r.nm_id)!.set(d, (viewsByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.views ?? 0));
    clicksByNm.get(r.nm_id)!.set(d, (clicksByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.clicks ?? 0));
  }
  for (const r of (funnelRes.data ?? []) as FunnelCartRow[]) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const d = String(r.date).slice(0, 10);
    if (!cartByNm.has(r.nm_id)) cartByNm.set(r.nm_id, new Map());
    cartByNm.get(r.nm_id)!.set(d, (cartByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.add_to_cart ?? 0));
  }
  // агрегат по всем nm — для сводки строки
  const viewsByDateAll = new Map<string, number>(), clicksByDateAll = new Map<string, number>(), cartByDateAll = new Map<string, number>();
  for (const r of (adRes.data ?? []) as AdNmRow[]) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const d = String(r.date).slice(0, 10);
    viewsByDateAll.set(d, (viewsByDateAll.get(d) ?? 0) + Number(r.views ?? 0));
    clicksByDateAll.set(d, (clicksByDateAll.get(d) ?? 0) + Number(r.clicks ?? 0));
  }
  for (const r of (funnelRes.data ?? []) as FunnelCartRow[]) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
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
  const asOf = currentMoscowDate();
  const period = days.map((d) => { const dt = new Date(d); return { label: `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`, period_type: WEEKDAY[dt.getDay()] }; });

  const skuDailyRows = ((skuRes.data ?? []) as SkuDailyRow[]).filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));
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
  const totals = ((totalsRes.data ?? []) as RpcTotal[]).filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));
  const stockTotal = totals.reduce((a, r) => a + Number(r.stock ?? 0), 0);
  const stockMoneyTotal = totals.reduce((a, r) => a + Number(r.stock ?? 0) * Number(r.cost ?? 0), 0);

  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");
  const totalByNm = new Map<number, RpcTotal>();
  for (const t of totals) totalByNm.set(t.nm_id, t);
  const byNm = new Map<number, Map<string, DailyRow>>();
  for (const r of skuDailyRows) {
    if (!byNm.has(r.nm_id)) byNm.set(r.nm_id, new Map());
    byNm.get(r.nm_id)!.set(String(r.d).slice(0, 10), r);
  }

  const skus = [...totalByNm.values()]
    .map((t) => {
      const dmap = byNm.get(t.nm_id) ?? new Map<string, DailyRow>();
      const metrics = buildMetrics(days, asOf, dmap, Number(t.stock ?? 0), Math.round(Number(t.stock ?? 0) * Number(t.cost ?? 0)), Number(t.cost ?? 0), wbCostForNm(t.nm_id));
      metrics.unshift(...buildFunnelMetrics(days, asOf, viewsByNm.get(t.nm_id) ?? new Map(), clicksByNm.get(t.nm_id) ?? new Map(), cartByNm.get(t.nm_id) ?? new Map()));
      const orders = metrics.find((m) => m.field === "orders_count")?.total ?? 0;
      return { nm: t.nm_id, art: t.article || String(t.nm_id), name: nameByArt.get(t.article) || t.article || String(t.nm_id), img_url: wbCardImageUrl(t.nm_id), metrics, _o: orders };
    })
    .sort((a, b) => b._o - a._o)
    .map(({ _o, ...rest }) => { void _o; return rest; });

  // Сводка: базовые метрики из дневной агрегации + Валовая/Маржа вклеиваем суммой по SKU (себес разный)
  const summary = buildMetrics(days, asOf, dailyByDate, stockTotal, Math.round(stockMoneyTotal));
  summary.unshift(...buildFunnelMetrics(days, asOf, viewsByDateAll, clicksByDateAll, cartByDateAll));
  const sumDaily = (field: string) => days.map((_, i) => {
    let acc = 0, any = false;
    for (const sk of skus) { const m = sk.metrics.find((x) => x.field === field); const v = m?.daily[i]; if (v != null) { acc += Number(v); any = true; } }
    return any ? Math.round(acc) : null;
  });
  const grossDaily = sumDaily("gross");
  const costedSkus = skus.filter((sku) => sku.metrics.some((metric) => metric.field === "gross" && metric.total != null));
  const costedSkuCount = costedSkus.length;
  const economyCoveragePct = skus.length ? Math.round(costedSkuCount / skus.length * 1_000) / 10 : 0;
  const grossTotal = skus.reduce((a, sk) => a + (sk.metrics.find((x) => x.field === "gross")?.total ?? 0), 0);
  const costedBuyoutsSumDaily = days.map((day, index) => day > asOf ? null : costedSkus.reduce(
    (sum, sku) => sum + Number(sku.metrics.find((metric) => metric.field === "buyouts_sum")?.daily[index] ?? 0),
    0,
  ));
  const costedBuyoutsSumTotal = costedSkus.reduce(
    (sum, sku) => sum + Number(sku.metrics.find((metric) => metric.field === "buyouts_sum")?.total ?? 0),
    0,
  );
  const adIdx = summary.findIndex((m) => m.field === "drr");
  summary.splice(adIdx + 1, 0,
    { field: "gross", label: "Прибыль после расходов МП, ₽", kind: "money", daily: grossDaily, total: costedSkuCount ? Math.round(grossTotal) : null, forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама", group_start: true },
    { field: "margin_pct", label: "Расчётная маржа после рекламы, %", kind: "pct", daily: days.map((day, i) => { const buyouts = Number(costedBuyoutsSumDaily[i] ?? 0); const gross = grossDaily[i]; return day <= asOf && buyouts > 0 && gross != null ? Math.round((gross / buyouts) * 1000) / 10 : null; }), total: costedSkuCount && costedBuyoutsSumTotal > 0 ? Math.round((grossTotal / costedBuyoutsSumTotal) * 1000) / 10 : null, forecast: null, source: "WB Финотчёт + себестоимость + WB Реклама" },
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
  if (gmroiM) gmroiM.total = costedSkuCount && stockMoneyTotal > 0 ? Math.round(Math.min(999, (grossTotal / stockMoneyTotal) * 100) * 10) / 10 : null;
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
    forecast_note: "Прогноз использует факт, профиль дня недели и краткосрочный тренд. Календарь акций WB пока не подключён, поэтому диапазон учитывает дополнительную неопределённость.",
    period,
    summary,
    skus,
  };
}
