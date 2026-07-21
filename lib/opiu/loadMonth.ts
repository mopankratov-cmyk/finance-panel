import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getWbCommissionForCabinet, resolveWbRatesForNm } from "@/lib/wb/commissions";
import type { WbAdStat, WbOrder, WbReportRow } from "@/lib/wb/types";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { supabase } from "@/lib/supabase";
import { OPIU_ENTITY, OPIU_WB_CABINET_ID } from "./constants";
import { buildOpiuReport, type OpiuReport } from "./buildReport";
import { weeksInMonth, type MonthWeek } from "./weeks";
import type { ProductCostRow } from "./metrics";

export async function fetchOrders(
  dateFrom: string,
  dateTo: string,
  _refresh = false,
): Promise<WbOrder[]> {
  const client = getSupabaseAdmin() ?? supabase;
  const rows = await loadAllSupabasePages<{
    nm_id: number; supplier_article: string | null; date: string; total_price: number | null;
    discount_percent: number | null; finished_price: number | null; is_cancel: boolean | null; warehouse: string | null;
  }>((from, to) => client
    .from("wb_orders")
    .select("nm_id, supplier_article, date, total_price, discount_percent, finished_price, is_cancel, warehouse")
    .eq("cabinet_id", OPIU_WB_CABINET_ID)
    .gte("date", dateFrom)
    .lte("date", `${dateTo}T23:59:59.999Z`)
    .order("date", { ascending: true })
    .range(from, to), { maxPages: 300, label: "ОПиУ: заказы WB" });
  return rows.map((row) => ({
    date: row.date,
    nmId: row.nm_id,
    supplierArticle: row.supplier_article ?? undefined,
    totalPrice: row.total_price ?? undefined,
    discountPercent: row.discount_percent ?? undefined,
    finishedPrice: row.finished_price ?? undefined,
    isCancel: Boolean(row.is_cancel),
    warehouseName: row.warehouse ?? undefined,
  }));
}

export async function fetchSalesFromCache(dateFrom: string, dateTo: string): Promise<WbReportRow[]> {
  const client = getSupabaseAdmin() ?? supabase;
  const [sales, stocks, commission] = await Promise.all([
    loadAllSupabasePages<{
      nm_id: number; date: string; sale_id: string; for_pay: number | null;
      finished_price: number | null; price_with_disc: number | null;
    }>((from, to) => client
      .from("wb_sales")
      .select("nm_id, date, sale_id, for_pay, finished_price, price_with_disc")
      .eq("cabinet_id", OPIU_WB_CABINET_ID)
      .gte("date", dateFrom)
      .lte("date", `${dateTo}T23:59:59.999Z`)
      .order("date", { ascending: true })
      .order("sale_id", { ascending: true })
      .range(from, to), { maxPages: 300, label: "ОПиУ: продажи WB" }),
    loadAllSupabasePages<{ nm_id: number; article: string | null }>(async (from, to) => {
      const result = await client
        .rpc("rnp_report", { p_cabinet: OPIU_WB_CABINET_ID })
        .select("nm_id, article")
        .order("nm_id", { ascending: true })
        .range(from, to);
      return {
        data: (result.data ?? []) as unknown as Array<{ nm_id: number; article: string | null }>,
        error: result.error,
      };
    }, { maxPages: 100, label: "ОПиУ: товары WB" }),
    getWbCommissionForCabinet(OPIU_WB_CABINET_ID, 30, { allowLiveFallback: false }),
  ]);
  const articleByNm = new Map<number, string>();
  for (const row of stocks) {
    const article = String(row.article || "").trim();
    if (article && !articleByNm.has(Number(row.nm_id))) articleByNm.set(Number(row.nm_id), article);
  }
  return sales.map((row) => {
    const amount = Math.abs(Number(row.price_with_disc ?? row.finished_price ?? row.for_pay ?? 0));
    const returned = String(row.sale_id || "").toUpperCase().startsWith("R");
    const rates = resolveWbRatesForNm(commission, Number(row.nm_id));
    return {
      rr_dt: row.date,
      nm_id: row.nm_id,
      sa_name: articleByNm.get(Number(row.nm_id)) ?? "",
      quantity: 1,
      doc_type_name: returned ? "Возврат" : "Продажа",
      supplier_oper_name: returned ? "Возврат" : "Продажа",
      retail_amount: returned ? 0 : amount,
      retail_price_withdisc_rub: returned ? 0 : amount,
      ppvz_for_pay: Number(row.for_pay ?? 0),
      ppvz_sales_commission: returned ? 0 : amount * rates.commissionPct / 100,
      acquiring_fee: returned ? 0 : amount * rates.acquiringPct / 100,
      deduction: returned ? 0 : amount * (rates.extraPct + rates.overheadPct) / 100,
    } satisfies WbReportRow;
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
    fetchSalesFromCache(dateFrom, dateTo),
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
