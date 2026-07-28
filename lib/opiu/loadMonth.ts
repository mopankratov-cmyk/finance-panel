import { wbFetch } from "@/lib/wb/fetch";
import { fetchSalesReport } from "@/lib/wb/fetchSalesReport";
import type { WbOrder } from "@/lib/wb/types";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { supabase } from "@/lib/supabase";
import { OPIU_ENTITY } from "./constants";
import { buildOpiuReport, type OpiuReport } from "./buildReport";
import { weeksInMonth, type MonthWeek } from "./weeks";
import type { ProductCostRow, AdvertSpendRow } from "./metrics";
import { fetchGoogleSheetCosts, fetchDeliveryCosts } from "./fetchGoogleCosts";
import { fetchNmOrderStats } from "./fetchNmStats";

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

interface WbAdvertUpdItem {
  updTime?: string;
  updSum?: number;
  [key: string]: unknown;
}

// Расход на рекламу — advert-api.wildberries.ru/adv/v1/upd (история списаний).
// Дата в формате YYYY-MM-DD (без времени). Использует stats-токен — WB_TOKEN_ADVERT
// для этого endpoint отозван, stats-токен принимается.
async function fetchAdStats(
  dateFrom: string,
  dateTo: string,
  refresh: boolean,
): Promise<AdvertSpendRow[]> {
  const statsToken =
    process.env.WB_STATS_TOKEN ?? process.env.WB_TOKEN_STATISTICS ?? "";
  if (!statsToken) {
    console.warn("[opiu] WB_STATS_TOKEN не настроен — реклама будет 0");
    return [];
  }

  const url = `https://advert-api.wildberries.ru/adv/v1/upd?from=${dateFrom}&to=${dateTo}`;
  const cacheOpt: RequestInit = refresh
    ? { cache: "no-store" }
    : { cache: "force-cache" } as RequestInit;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: statsToken, "Content-Type": "application/json" },
      ...cacheOpt,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[opiu] advert upd HTTP", res.status, text.slice(0, 200));
      return [];
    }
    const data = (await res.json()) as WbAdvertUpdItem[];
    if (!Array.isArray(data)) {
      console.error("[opiu] advert upd unexpected response:", JSON.stringify(data).slice(0, 200));
      return [];
    }
    return data.map((item) => ({
      date: String(item.updTime ?? "").slice(0, 10),
      sum: Number(item.updSum ?? 0),
    }));
  } catch (err) {
    console.error("[opiu] advert upd fetch error:", err);
    return [];
  }
}

async function fetchProductCosts(): Promise<ProductCostRow[]> {
  // Сначала пробуем Google Sheets (актуальная себестоимость + подготовка)
  try {
    const rows = await fetchGoogleSheetCosts();
    if (rows.length > 0) {
      return rows.map((r) => ({
        article: r.article,
        wb_barcode: null,
        cost_rub: r.cost_rub,
        packaging_rub: r.packaging_rub,
      }));
    }
  } catch (err) {
    console.warn("[opiu] Google Sheets costs fetch failed, falling back to Supabase:", err);
  }

  // Fallback: Supabase product_costs (без packaging_rub)
  const client = getSupabaseAdmin() ?? supabase;
  const { data, error } = await client
    .from("product_costs")
    .select("article, wb_barcode, cost_rub")
    .eq("entity", OPIU_ENTITY);

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, packaging_rub: 0 })) as ProductCostRow[];
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

  // Рекламный API ограничен 1 месяцем — используем границы самого месяца
  const monthStart = `${month}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  // Воронка продаж v3: запускаем параллельно с остальными запросами,
  // но внутри — последовательно с паузой 300мс, чтобы не получить rate limit
  const nmStatsPromise = (async () => {
    const result: import("./fetchNmStats").NmStatRow[] = [];
    for (let i = 0; i < weeks.length; i++) {
      if (i > 0) await new Promise<void>((r) => setTimeout(r, 2000));
      try {
        const rows = await fetchNmOrderStats(weeks[i]!.rangeFrom, weeks[i]!.rangeTo, refresh);
        result.push(...rows);
      } catch (e) {
        console.warn("[opiu] sales-funnel fetch failed:", e);
      }
    }
    return result;
  })();

  const [sales, orders, adStats, costs, deliveryCosts, nmStats] = await Promise.all([
    fetchSalesReport(dateFrom, dateTo, refresh),
    fetchOrders(dateFrom, dateTo, refresh),
    fetchAdStats(monthStart, monthEnd, refresh),
    fetchProductCosts(),
    fetchDeliveryCosts().catch((e) => {
      console.warn("[opiu] delivery costs fetch failed:", e);
      return [];
    }),
    nmStatsPromise,
  ]);

  const report = buildOpiuReport(weeks, sales, orders, adStats, costs, deliveryCosts, nmStats);

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
