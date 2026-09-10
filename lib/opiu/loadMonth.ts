import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { WbAdStat, WbReportRow } from "@/lib/wb/types";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveOpiuBrand, resolveOpiuBrands, siblingBrandCount, type OpiuBrand } from "./constants";
import { buildOpiuReportFromWeekMetrics, mergeMissingCostArticles, type OpiuReport } from "./buildReport";
import { loadReadyFunnelFacts } from "./loadFunnelOrders";
import { periodFromRange, weeksInMonth, type MonthWeek } from "./weeks";
import {
  aggregateWeek,
  buildCostLookup,
  findMissingCostArticles,
  loanTransferRub,
  overlayFunnelOrders,
  rowDate,
  sumWeeks,
  type MissingCostArticle,
  type OpiuOrder,
  type ProductCostRow,
} from "./metrics";
import { fetchReportRows, rowsBySaleDate } from "./reportRows";
import { fetchPaidStorageByWeek } from "./paidStorage";
import { fetchAdsSpendBySourceByWeek } from "./adsSpendBySource";

function financeDb() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase service role не настроен");
  return db;
}

/** Совпадает ли артикул с хотя бы одним префиксом суб-бренда (регистронезависимо). Без префиксов — всегда true (фильтра нет). */
export function matchesArticlePrefix(article: string | null | undefined, prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) return true;
  const normalized = String(article ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return prefixes.some((p) => normalized.startsWith(p.toUpperCase()));
}

/**
 * nm_id этого суб-бренда — для фильтрации wb_advert_nm_daily (там нет артикула,
 * только nm_id). undefined = фильтра не нужно (бренд без articlePrefixes).
 */
function brandNmIdWhitelist(
  brand: OpiuBrand,
  orders: OpiuOrder[],
  saleDateRows: WbReportRow[],
): Set<number> | undefined {
  if (!brand.articlePrefixes?.length) return undefined;
  const ids = new Set<number>();
  for (const o of orders) if (o.nmId != null) ids.add(o.nmId);
  for (const r of saleDateRows) {
    const nmId = Number(r.nm_id);
    if (Number.isFinite(nmId)) ids.add(nmId);
  }
  return ids;
}

export async function fetchOrders(
  dateFrom: string,
  dateTo: string,
  _refresh = false,
  brand: OpiuBrand = resolveOpiuBrand(undefined),
): Promise<OpiuOrder[]> {
  const client = financeDb();
  const rowsPromise = loadAllSupabasePages<{
      id: number; cabinet_id: string; nm_id: number; supplier_article: string | null; date: string; total_price: number | null;
      discount_percent: number | null; finished_price: number | null; price_with_disc: number | null; spp: number | null; is_cancel: boolean | null; warehouse: string | null; region: string | null;
    }>((from, to) => client
      .from("wb_orders")
      .select("id, cabinet_id, nm_id, supplier_article, date, total_price, discount_percent, finished_price, price_with_disc, spp, is_cancel, warehouse, region")
      .eq("cabinet_id", brand.cabinetId)
      .gte("date", dateFrom)
      .lte("date", `${dateTo}T23:59:59.999Z`)
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .order("cabinet_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to), { maxPages: 300, label: "ОПиУ: заказы WB" });
  const funnelFacts = await loadReadyFunnelFacts(
    client,
    brand.cabinetId,
    dateFrom,
    dateTo,
  );
  const rows = await rowsPromise;
  const cachedOrders: OpiuOrder[] = rows.map((row) => ({
    date: row.date,
    nmId: row.nm_id,
    supplierArticle: row.supplier_article ?? undefined,
    totalPrice: row.total_price ?? undefined,
    discountPercent: row.discount_percent ?? undefined,
    finishedPrice: row.finished_price ?? undefined,
    priceWithDisc: row.price_with_disc ?? undefined,
    spp: row.spp ?? undefined,
    isCancel: Boolean(row.is_cancel),
    warehouseName: row.warehouse ?? undefined,
    regionName: row.region ?? undefined,
  }));
  const overlaid = overlayFunnelOrders(cachedOrders, funnelFacts, brand.cabinetId);
  if (!brand.articlePrefixes?.length) return overlaid;
  // Суб-бренд внутри общего кабинета: Воронка не хранит артикул (только
  // nm_id), поэтому whitelist nm_id считаем по сырым wb_orders (у них
  // supplier_article есть), а фильтруем уже итоговый (после оверлея) список —
  // так под фильтр подпадают и синтетические записи из Воронки.
  const brandNmIds = new Set(
    rows
      .filter((r) => matchesArticlePrefix(r.supplier_article, brand.articlePrefixes))
      .map((r) => r.nm_id),
  );
  return overlaid.filter((o) => o.nmId != null && brandNmIds.has(o.nmId));
}

// Расход на рекламу берём из синхронизированной таблицы wb_advert_nm_daily (cron),
// а не из живого advert/v3/fullstats — у того лимит 1 запрос/мин → ОПиУ ловил 429/500.
// nmIdWhitelist — для суб-брендов внутри общего кабинета (Norvia/Heaton): таблица
// хранит расход по nm_id, а не по артикулу, поэтому фильтр по префиксу артикула
// применяем через набор nm_id, уже вычисленный по заказам/отчёту этого суб-бренда.
async function fetchAdStats(
  dateFrom: string,
  dateTo: string,
  brand: OpiuBrand,
  nmIdWhitelist?: Set<number>,
): Promise<WbAdStat[]> {
  const client = financeDb();
  const { data, error } = await client
    .from("wb_advert_nm_daily")
    .select("date, spent, nm_id")
    .eq("cabinet_id", brand.cabinetId)
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (error) {
    console.error("[opiu] ad stats read:", error.message);
    return [];
  }

  // Агрегируем расход по дате → один WbAdStat с массивом days (как ждёт adsSpendInRange).
  const byDate = new Map<string, number>();
  for (const row of data ?? []) {
    if (nmIdWhitelist && !nmIdWhitelist.has(Number(row.nm_id))) continue;
    const d = String(row.date).slice(0, 10);
    byDate.set(d, (byDate.get(d) ?? 0) + Number(row.spent ?? 0));
  }
  if (byDate.size === 0) return [];
  const days = [...byDate.entries()].map(([date, sum]) => ({ date, sum }));
  return [{ days }];
}

/**
 * Себестоимость ищем по ВСЕЙ таблице product_costs, без фильтра по entity
 * бренда: артикул — уникальный ключ на весь каталог (проверено — ни одного
 * пересечения между юрлицами), а владельца товара и кабинет, через который
 * он продаётся, часто разные (тот же принцип, что и в списании FBS —
 * lib/warehouse/fbsSales.ts: "владельца определяет ТОВАР, а не кабинет").
 * Например, TIM TIN/ООО РИО продаётся через кабинет ИП Панкратова — раньше
 * фильтр по entity="ИП ПАНКРАТОВ" такие товары терял, и себестоимость в
 * ОПиУ занижалась на весь их объём продаж.
 */
export async function fetchProductCosts(brand: OpiuBrand): Promise<ProductCostRow[]> {
  const client = financeDb();
  const { data, error } = await client
    .from("product_costs")
    .select("article, wb_barcode, cost_rub, warehouse_expenses");

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ProductCostRow[];
  if (!brand.articlePrefixes?.length) return rows;
  return rows.filter((r) => matchesArticlePrefix(r.article, brand.articlePrefixes));
}

async function fetchWarehouseCosts(
  month: string,
  weeks: MonthWeek[],
  brand: OpiuBrand,
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  const client = financeDb();
  const { data, error } = await client
    .from("opiu_warehouse_costs")
    .select("week_start, amount")
    .eq("entity", brand.entity)
    .eq("month", month);

  if (error) {
    console.error("[opiu] warehouse costs read:", error.message);
    return map;
  }

  for (const row of data ?? []) {
    const key = String(row.week_start).slice(0, 10);
    map[key] = Number(row.amount) || 0;
  }

  for (const w of weeks) {
    if (!(w.weekStart in map)) map[w.weekStart] = 0;
  }

  return map;
}

/**
 * "Перевод на баланс заёмщика" в финотчёте WB приходит без артикула и без
 * nm_id (общекабинетный расход по кредиту/займу, не привязанный к товару).
 * Когда общий WB-кабинет разбит на суб-бренды по префиксу артикула
 * (Norvia/Heaton — оба на Retail Family), такие строки не проходят ни под
 * один префикс и выпадают из отчёта у обоих. По решению владельца — делим
 * поровну между суб-брендами кабинета. rawRows — НЕотфильтрованные по
 * префиксу строки всего кабинета (до matchesArticlePrefix).
 */
function sharedLoanTransferByWeek(
  rawRows: WbReportRow[],
  weeks: MonthWeek[],
  brand: OpiuBrand,
): Record<string, number> {
  const map: Record<string, number> = {};
  if (!brand.articlePrefixes?.length) return map;
  const siblings = siblingBrandCount(brand);

  for (const w of weeks) {
    const total = rawRows.reduce((sum, row) => {
      const date = rowDate(row);
      return date >= w.rangeFrom && date <= w.rangeTo ? sum + loanTransferRub(row) : sum;
    }, 0);
    map[w.weekStart] = total / siblings;
  }

  return map;
}

export interface OpiuLoadMeta {
  salesRows: number;
  ordersCount: number;
  costsCount: number;
  adCampaigns: number;
}

interface BrandMonthData {
  saleDateWeekMetrics: ReturnType<typeof aggregateWeek>[];
  reportDateWeekMetrics: ReturnType<typeof aggregateWeek>[];
  missingCostArticlesSale: MissingCostArticle[];
  missingCostArticlesReport: MissingCostArticle[];
  warehouseByWeek: Record<string, number>;
  reportRowIds: Set<number>;
  ordersCount: number;
  costs: ProductCostRow[];
  adCampaigns: number;
}

async function loadBrandMonthData(
  brand: OpiuBrand,
  weeks: MonthWeek[],
  dateFrom: string,
  dateTo: string,
  month: string,
  refresh: boolean,
): Promise<BrandMonthData> {
  const [
    saleDateRowsRaw,
    reportDateRowsRaw,
    orders,
    costs,
    warehouseByWeek,
  ] = await Promise.all([
    fetchReportRows(dateFrom, dateTo, "sale", brand.cabinetId),
    fetchReportRows(dateFrom, dateTo, "report", brand.cabinetId),
    fetchOrders(dateFrom, dateTo, refresh, brand),
    fetchProductCosts(brand),
    fetchWarehouseCosts(month, weeks, brand),
  ]);
  const saleDateRows = saleDateRowsRaw.filter((r) => matchesArticlePrefix(r.sa_name, brand.articlePrefixes));
  const reportDateRows = reportDateRowsRaw.filter((r) => matchesArticlePrefix(r.sa_name, brand.articlePrefixes));
  const nmIdWhitelist = brandNmIdWhitelist(brand, orders, saleDateRows);
  const adStats = await fetchAdStats(dateFrom, dateTo, brand, nmIdWhitelist);

  const loanTransferBySaleWeek = sharedLoanTransferByWeek(rowsBySaleDate(saleDateRowsRaw), weeks, brand);
  const loanTransferByReportWeek = sharedLoanTransferByWeek(reportDateRowsRaw, weeks, brand);
  const paidStorageByWeek = await fetchPaidStorageByWeek(brand, weeks);
  const adsSpendBySourceByWeek = await fetchAdsSpendBySourceByWeek(brand, weeks);

  const costLookup = buildCostLookup(costs);
  const saleDateSales = rowsBySaleDate(saleDateRows);

  const saleDateWeekMetrics = weeks.map((w) =>
    aggregateWeek(
      w,
      saleDateSales,
      orders,
      adStats,
      costLookup,
      warehouseByWeek[w.weekStart] ?? 0,
      loanTransferBySaleWeek[w.weekStart] ?? 0,
      paidStorageByWeek ? (paidStorageByWeek[w.weekStart] ?? 0) : null,
      adsSpendBySourceByWeek ? (adsSpendBySourceByWeek[w.weekStart] ?? { balance: 0, bonus: 0 }) : null,
    ),
  );
  const reportDateWeekMetrics = weeks.map((w) =>
    aggregateWeek(
      w,
      reportDateRows,
      orders,
      adStats,
      costLookup,
      warehouseByWeek[w.weekStart] ?? 0,
      loanTransferByReportWeek[w.weekStart] ?? 0,
      paidStorageByWeek ? (paidStorageByWeek[w.weekStart] ?? 0) : null,
      adsSpendBySourceByWeek ? (adsSpendBySourceByWeek[w.weekStart] ?? { balance: 0, bonus: 0 }) : null,
    ),
  );

  const reportRowIds = new Set(
    [...saleDateRows, ...reportDateRows]
      .map((row) => Number(row.rrd_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  );

  return {
    saleDateWeekMetrics,
    reportDateWeekMetrics,
    missingCostArticlesSale: findMissingCostArticles(saleDateSales, costLookup),
    missingCostArticlesReport: findMissingCostArticles(reportDateRows, costLookup),
    warehouseByWeek,
    reportRowIds,
    ordersCount: orders.reduce((sum, order) => sum + (order.ordersCount ?? 1), 0),
    costs,
    adCampaigns: adStats.length,
  };
}

function mergeWarehouseByWeek(
  perBrand: Record<string, number>[],
  weeks: MonthWeek[],
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const w of weeks) {
    merged[w.weekStart] = perBrand.reduce((sum, byWeek) => sum + (byWeek[w.weekStart] ?? 0), 0);
  }
  return merged;
}

/** Число уникальных артикулов в объединении себестоимостей нескольких брендов (артикул — уникальный ключ на весь каталог, см. fetchProductCosts). */
function uniqueCostsCount(perBrandCosts: ProductCostRow[][]): number {
  const seen = new Set<string>();
  for (const costs of perBrandCosts) {
    for (const c of costs) seen.add(c.article.trim().toUpperCase());
  }
  return seen.size;
}

export async function loadOpiuMonth(
  year: number,
  monthIndex: number,
  refresh = false,
  brandIds?: string[],
): Promise<{
  month: string;
  report: OpiuReport;
  reportByReportDate: OpiuReport;
  timestamp: string;
  meta: OpiuLoadMeta;
}> {
  const brands = resolveOpiuBrands(brandIds);
  const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const weeks = weeksInMonth(year, monthIndex);
  if (weeks.length === 0) {
    return {
      month,
      report: { weeks: [], rows: [], warehouseByWeek: {}, missingCostArticles: [] },
      reportByReportDate: { weeks: [], rows: [], warehouseByWeek: {}, missingCostArticles: [] },
      timestamp: new Date().toISOString(),
      meta: { salesRows: 0, ordersCount: 0, costsCount: 0, adCampaigns: 0 },
    };
  }

  const dateFrom = weeks[0]!.rangeFrom;
  const dateTo = weeks[weeks.length - 1]!.rangeTo;

  const perBrand = await Promise.all(
    brands.map((brand) => loadBrandMonthData(brand, weeks, dateFrom, dateTo, month, refresh)),
  );

  const saleDateWeekMetrics = weeks.map((_, i) => sumWeeks(perBrand.map((p) => p.saleDateWeekMetrics[i]!)));
  const reportDateWeekMetrics = weeks.map((_, i) => sumWeeks(perBrand.map((p) => p.reportDateWeekMetrics[i]!)));
  const warehouseByWeek = mergeWarehouseByWeek(perBrand.map((p) => p.warehouseByWeek), weeks);
  const missingCostArticlesSale = mergeMissingCostArticles(perBrand.map((p) => p.missingCostArticlesSale));
  const missingCostArticlesReport = mergeMissingCostArticles(perBrand.map((p) => p.missingCostArticlesReport));

  const report = buildOpiuReportFromWeekMetrics(weeks, saleDateWeekMetrics, missingCostArticlesSale, warehouseByWeek);
  const reportByReportDate = buildOpiuReportFromWeekMetrics(weeks, reportDateWeekMetrics, missingCostArticlesReport, warehouseByWeek);

  const reportRowIds = new Set<number>();
  for (const p of perBrand) for (const id of p.reportRowIds) reportRowIds.add(id);

  return {
    month,
    report,
    reportByReportDate,
    timestamp: new Date().toISOString(),
    meta: {
      salesRows: reportRowIds.size,
      ordersCount: perBrand.reduce((sum, p) => sum + p.ordersCount, 0),
      costsCount: uniqueCostsCount(perBrand.map((p) => p.costs)),
      adCampaigns: perBrand.reduce((sum, p) => sum + p.adCampaigns, 0),
    },
  };
}

interface BrandSalePeriodData {
  weekMetrics: ReturnType<typeof aggregateWeek>;
  missingCostArticles: MissingCostArticle[];
  salesRows: number;
  ordersCount: number;
  costs: ProductCostRow[];
  adCampaigns: number;
}

async function loadBrandSalePeriodData(
  brand: OpiuBrand,
  period: MonthWeek,
  dateFrom: string,
  dateTo: string,
): Promise<BrandSalePeriodData> {
  const [saleDateRowsRaw, orders, costs] = await Promise.all([
    fetchReportRows(dateFrom, dateTo, "sale", brand.cabinetId),
    fetchOrders(dateFrom, dateTo, false, brand),
    fetchProductCosts(brand),
  ]);
  const saleDateRows = saleDateRowsRaw.filter((r) => matchesArticlePrefix(r.sa_name, brand.articlePrefixes));
  const nmIdWhitelist = brandNmIdWhitelist(brand, orders, saleDateRows);
  const adStats = await fetchAdStats(dateFrom, dateTo, brand, nmIdWhitelist);
  const loanTransferByWeek = sharedLoanTransferByWeek(rowsBySaleDate(saleDateRowsRaw), [period], brand);
  const paidStorageByWeek = await fetchPaidStorageByWeek(brand, [period]);
  const adsSpendBySourceByWeek = await fetchAdsSpendBySourceByWeek(brand, [period]);

  const costLookup = buildCostLookup(costs);
  const saleDateSales = rowsBySaleDate(saleDateRows);
  const weekMetrics = aggregateWeek(
    period,
    saleDateSales,
    orders,
    adStats,
    costLookup,
    0,
    loanTransferByWeek[period.weekStart] ?? 0,
    paidStorageByWeek ? (paidStorageByWeek[period.weekStart] ?? 0) : null,
    adsSpendBySourceByWeek ? (adsSpendBySourceByWeek[period.weekStart] ?? { balance: 0, bonus: 0 }) : null,
  );

  return {
    weekMetrics,
    missingCostArticles: findMissingCostArticles(saleDateSales, costLookup),
    salesRows: saleDateRows.length,
    ordersCount: orders.reduce((sum, order) => sum + (order.ordersCount ?? 1), 0),
    costs,
    adCampaigns: adStats.length,
  };
}

/** ОПиУ по дате продажи за произвольный диапазон дат — один агрегат, без разбивки по неделям. */
export async function loadOpiuSalePeriod(
  dateFrom: string,
  dateTo: string,
  brandIds?: string[],
): Promise<{
  report: OpiuReport;
  timestamp: string;
  meta: OpiuLoadMeta;
}> {
  const brands = resolveOpiuBrands(brandIds);
  const period = periodFromRange(dateFrom, dateTo);

  const perBrand = await Promise.all(
    brands.map((brand) => loadBrandSalePeriodData(brand, period, dateFrom, dateTo)),
  );

  const weekMetrics = sumWeeks(perBrand.map((p) => p.weekMetrics));
  const missingCostArticles = mergeMissingCostArticles(perBrand.map((p) => p.missingCostArticles));
  const report = buildOpiuReportFromWeekMetrics([period], [weekMetrics], missingCostArticles, {});

  return {
    report,
    timestamp: new Date().toISOString(),
    meta: {
      salesRows: perBrand.reduce((sum, p) => sum + p.salesRows, 0),
      ordersCount: perBrand.reduce((sum, p) => sum + p.ordersCount, 0),
      costsCount: uniqueCostsCount(perBrand.map((p) => p.costs)),
      adCampaigns: perBrand.reduce((sum, p) => sum + p.adCampaigns, 0),
    },
  };
}

export async function saveWarehouseCost(
  month: string,
  weekStart: string,
  amount: number,
): Promise<void> {
  const client = financeDb();
  const { error } = await client.from("opiu_warehouse_costs").upsert(
    {
      entity: resolveOpiuBrand(undefined).entity,
      month,
      week_start: weekStart,
      amount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entity,month,week_start" },
  );
  if (error) throw new Error(error.message);
}
