import { wbFetch } from "@/lib/wb/fetch";
import { fetchSalesReport } from "@/lib/wb/fetchSalesReport";
import type { WbAdStat, WbOrder } from "@/lib/wb/types";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { supabase } from "@/lib/supabase";
import { OPIU_ENTITY } from "./constants";
import { buildOpiuReport, type OpiuReport } from "./buildReport";
import { weeksInMonth, type MonthWeek } from "./weeks";
import type { ProductCostRow } from "./metrics";

async function fetchOrders(
  dateFrom: string,
  dateTo: string,
  refresh: boolean,
): Promise<WbOrder[]> {
  const url = new URL(
    "https://statistics-api.wildberries.ru/api/v1/supplier/orders",
  );
  url.searchParams.set("dateFrom", dateFrom);
  url.searchParams.set("flag", "0");

  const res = await wbFetch<WbOrder[]>(url.toString(), { method: "GET" }, { refresh });
  if (res.error) throw new Error(res.error);
  return (res.data ?? []).filter((o) => {
    const d = String(o.date ?? "").slice(0, 10);
    return d >= dateFrom && d <= dateTo;
  });
}

// Расход на рекламу берём из синхронизированной таблицы wb_advert_nm_daily (cron),
// а не из живого advert/v3/fullstats — у того лимит 1 запрос/мин → ОПиУ ловил 429/500.
async function fetchAdStats(
  dateFrom: string,
  dateTo: string,
): Promise<WbAdStat[]> {
  const client = getSupabaseAdmin() ?? supabase;
  const { data, error } = await client
    .from("wb_advert_nm_daily")
    .select("date, spent")
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
  const client = getSupabaseAdmin() ?? supabase;
  const { data, error } = await client
    .from("product_costs")
    .select("article, wb_barcode, cost_rub")
    .eq("entity", OPIU_ENTITY);

  if (error) throw new Error(error.message);
  return (data ?? []) as ProductCostRow[];
}

async function fetchWarehouseCosts(
  month: string,
  weeks: MonthWeek[],
): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  const client = getSupabaseAdmin() ?? supabase;
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
): Promise<{ month: string; report: OpiuReport; timestamp: string; meta: OpiuLoadMeta }> {
  const month = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const weeks = weeksInMonth(year, monthIndex);
  if (weeks.length === 0) {
    return {
      month,
      report: { weeks: [], rows: [], warehouseByWeek: {} },
      timestamp: new Date().toISOString(),
      meta: { salesRows: 0, ordersCount: 0, costsCount: 0, adCampaigns: 0 },
    };
  }

  const dateFrom = weeks[0]!.rangeFrom;
  const dateTo = weeks[weeks.length - 1]!.rangeTo;

  const [sales, orders, adStats, costs, warehouseByWeek] = await Promise.all([
    fetchSalesReport(dateFrom, dateTo, refresh),
    fetchOrders(dateFrom, dateTo, refresh),
    fetchAdStats(dateFrom, dateTo),
    fetchProductCosts(),
    fetchWarehouseCosts(month, weeks),
  ]);

  const report = buildOpiuReport(weeks, sales, orders, adStats, costs, warehouseByWeek);

  return {
    month,
    report,
    timestamp: new Date().toISOString(),
    meta: {
      salesRows: sales.length,
      ordersCount: orders.length,
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
  const client = getSupabaseAdmin() ?? supabase;
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
