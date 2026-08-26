import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { WbAdStat } from "@/lib/wb/types";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { OPIU_ENTITY, OPIU_WB_CABINET_ID } from "./constants";
import { buildOpiuReport, type OpiuReport } from "./buildReport";
import { loadReadyFunnelFacts } from "./loadFunnelOrders";
import { periodFromRange, weeksInMonth, type MonthWeek } from "./weeks";
import {
  overlayFunnelOrders,
  type OpiuOrder,
  type ProductCostRow,
} from "./metrics";
import { fetchReportRows, rowsBySaleDate } from "./reportRows";
import { fetchDeliveryCosts } from "./fetchGoogleCosts";

function financeDb() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase service role не настроен");
  return db;
}

export async function fetchOrders(
  dateFrom: string,
  dateTo: string,
  _refresh = false,
): Promise<OpiuOrder[]> {
  const client = financeDb();
  const rowsPromise = loadAllSupabasePages<{
      id: number; cabinet_id: string; nm_id: number; supplier_article: string | null; date: string; total_price: number | null;
      discount_percent: number | null; finished_price: number | null; price_with_disc: number | null; spp: number | null; is_cancel: boolean | null; warehouse: string | null; region: string | null;
    }>((from, to) => client
      .from("wb_orders")
      .select("id, cabinet_id, nm_id, supplier_article, date, total_price, discount_percent, finished_price, price_with_disc, spp, is_cancel, warehouse, region")
      .eq("cabinet_id", OPIU_WB_CABINET_ID)
      .gte("date", dateFrom)
      .lte("date", `${dateTo}T23:59:59.999Z`)
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .order("cabinet_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to), { maxPages: 300, label: "ОПиУ: заказы WB" });
  const funnelFacts = await loadReadyFunnelFacts(
    client,
    OPIU_WB_CABINET_ID,
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
  return overlayFunnelOrders(cachedOrders, funnelFacts, OPIU_WB_CABINET_ID);
}

// Расход на рекламу берём из синхронизированной таблицы wb_advert_nm_daily (cron),
// а не из живого advert/v3/fullstats — у того лимит 1 запрос/мин → ОПиУ ловил 429/500.
async function fetchAdStats(
  dateFrom: string,
  dateTo: string,
): Promise<WbAdStat[]> {
  const client = financeDb();
  const { data, error } = await client
    .from("wb_advert_nm_daily")
    .select("date, spent")
    .eq("cabinet_id", OPIU_WB_CABINET_ID)
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (error) {
    console.error("[opiu] ad stats read:", error.message);
    return [];
  }

  // Агрегируем расход по дате → один WbAdStat с массивом days (как ждёт adsSpendInRange).
  const byDate = new Map<string, number>();
  for (const row of data ?? []) {
    const d = String(row.date).slice(0, 10);
    byDate.set(d, (byDate.get(d) ?? 0) + Number(row.spent ?? 0));
  }
  if (byDate.size === 0) return [];
  const days = [...byDate.entries()].map(([date, sum]) => ({ date, sum }));
  return [{ days }];
}

async function fetchProductCosts(): Promise<ProductCostRow[]> {
  const client = financeDb();
  const { data, error } = await client
    .from("product_costs")
    .select("article, wb_barcode, cost_rub, warehouse_expenses")
    .eq("entity", OPIU_ENTITY);

  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCostRow[];
}

async function fetchWarehouseCosts(
  month: string,
  weeks: MonthWeek[],
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  const client = financeDb();
  const { data, error } = await client
    .from("opiu_warehouse_costs")
    .select("week_start, amount")
    .eq("entity", OPIU_ENTITY)
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

export interface OpiuLoadMeta {
  salesRows: number;
  ordersCount: number;
  costsCount: number;
  adCampaigns: number;
}

export async function loadOpiuMonth(
  year: number,
  monthIndex: number,
  refresh = false,
): Promise<{
  month: string;
  report: OpiuReport;
  reportByReportDate: OpiuReport;
  timestamp: string;
  meta: OpiuLoadMeta;
}> {
  const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const weeks = weeksInMonth(year, monthIndex);
  if (weeks.length === 0) {
    return {
      month,
      report: { weeks: [], rows: [], warehouseByWeek: {} },
      reportByReportDate: { weeks: [], rows: [], warehouseByWeek: {} },
      timestamp: new Date().toISOString(),
      meta: { salesRows: 0, ordersCount: 0, costsCount: 0, adCampaigns: 0 },
    };
  }

  const dateFrom = weeks[0]!.rangeFrom;
  const dateTo = weeks[weeks.length - 1]!.rangeTo;
  const [
    saleDateRows,
    reportDateRows,
    orders,
    adStats,
    costs,
    warehouseByWeek,
    deliveryCosts,
  ] = await Promise.all([
    fetchReportRows(dateFrom, dateTo, "sale"),
    fetchReportRows(dateFrom, dateTo, "report"),
    fetchOrders(dateFrom, dateTo, refresh),
    fetchAdStats(dateFrom, dateTo),
    fetchProductCosts(),
    fetchWarehouseCosts(month, weeks),
    fetchDeliveryCosts().catch((e) => {
      console.error("[opiu] delivery costs read:", e instanceof Error ? e.message : e);
      return [];
    }),
  ]);

  const report = buildOpiuReport(
    weeks,
    rowsBySaleDate(saleDateRows),
    orders,
    adStats,
    costs,
    warehouseByWeek,
    deliveryCosts,
  );
  const reportByReportDate = buildOpiuReport(
    weeks,
    reportDateRows,
    orders,
    adStats,
    costs,
    warehouseByWeek,
    deliveryCosts,
  );
  const reportRowIds = new Set(
    [...saleDateRows, ...reportDateRows]
      .map((row) => Number(row.rrd_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  );

  return {
    month,
    report,
    reportByReportDate,
    timestamp: new Date().toISOString(),
    meta: {
      salesRows: reportRowIds.size,
      ordersCount: orders.reduce((sum, order) => sum + (order.ordersCount ?? 1), 0),
      costsCount: costs.length,
      adCampaigns: adStats.length,
    },
  };
}

/** ОПиУ по дате продажи за произвольный диапазон дат — один агрегат, без разбивки по неделям. */
export async function loadOpiuSalePeriod(
  dateFrom: string,
  dateTo: string,
): Promise<{
  report: OpiuReport;
  timestamp: string;
  meta: OpiuLoadMeta;
}> {
  const period = periodFromRange(dateFrom, dateTo);
  const [saleDateRows, orders, adStats, costs, deliveryCosts] = await Promise.all([
    fetchReportRows(dateFrom, dateTo, "sale"),
    fetchOrders(dateFrom, dateTo, false),
    fetchAdStats(dateFrom, dateTo),
    fetchProductCosts(),
    fetchDeliveryCosts().catch((e) => {
      console.error("[opiu] delivery costs read:", e instanceof Error ? e.message : e);
      return [];
    }),
  ]);

  const report = buildOpiuReport(
    [period],
    rowsBySaleDate(saleDateRows),
    orders,
    adStats,
    costs,
    {},
    deliveryCosts,
  );

  return {
    report,
    timestamp: new Date().toISOString(),
    meta: {
      salesRows: saleDateRows.length,
      ordersCount: orders.reduce((sum, order) => sum + (order.ordersCount ?? 1), 0),
      costsCount: costs.length,
      adCampaigns: adStats.length,
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
      entity: OPIU_ENTITY,
      month,
      week_start: weekStart,
      amount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "entity,month,week_start" },
  );
  if (error) throw new Error(error.message);
}
