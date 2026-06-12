import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export interface UnitProduct {
  article: string;
  name: string | null;
  nmId: number | null;
  /** полная себестоимость = закупка + складские расходы на единицу */
  cost: number;
  costBuy: number;
  costWarehouse: number;
  // факт за 7 дней (если были продажи)
  units: number;
  revenue: number;
  forPay: number;
  adSpend: number;
  /** факт. прибыль = к перечислению − себес×шт − реклама */
  factProfit: number | null;
  /** маржа % от выручки */
  factMarginPct: number | null;
}

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  }

  const weekAgo = new Date(Date.now() - 6 * 86400000);
  const weekAgoIso = weekAgo.toISOString();
  const weekAgoDate = weekAgoIso.slice(0, 10);

  try {
    const [costsRes, ordersRes, salesRes, adRes] = await Promise.all([
      db.from("product_costs").select("article, name, cost_rub, warehouse_expenses"),
      db
        .from("wb_orders")
        .select("nm_id, supplier_article")
        .gte("date", new Date(Date.now() - 30 * 86400000).toISOString())
        .not("supplier_article", "is", null)
        .limit(1000),
      db
        .from("wb_sales")
        .select("nm_id, for_pay, finished_price")
        .gte("date", weekAgoIso)
        .limit(1000),
      db
        .from("wb_advert_nm_daily")
        .select("nm_id, spent")
        .gte("date", weekAgoDate),
    ]);

    if (costsRes.error) throw new Error(costsRes.error.message);

    // article ↔ nm_id
    const articleToNm = new Map<string, number>();
    const nmToArticle = new Map<number, string>();
    for (const r of ordersRes.data ?? []) {
      if (!articleToNm.has(r.supplier_article)) articleToNm.set(r.supplier_article, r.nm_id);
      if (!nmToArticle.has(r.nm_id)) nmToArticle.set(r.nm_id, r.supplier_article);
    }

    // продажи по nm_id за неделю
    const salesByNm = new Map<number, { units: number; revenue: number; forPay: number }>();
    for (const s of salesRes.data ?? []) {
      const agg = salesByNm.get(s.nm_id) ?? { units: 0, revenue: 0, forPay: 0 };
      agg.units += 1;
      agg.revenue += Number(s.finished_price ?? 0);
      agg.forPay += Number(s.for_pay ?? 0);
      salesByNm.set(s.nm_id, agg);
    }

    // расход рекламы по nm_id за неделю
    const adByNm = new Map<number, number>();
    for (const a of adRes.data ?? []) {
      adByNm.set(a.nm_id, (adByNm.get(a.nm_id) ?? 0) + Number(a.spent ?? 0));
    }

    const products: UnitProduct[] = (costsRes.data ?? []).map((c) => {
      const article = c.article as string;
      const nmId = articleToNm.get(article) ?? null;
      const costBuy = Number(c.cost_rub ?? 0);
      const costWarehouse = Number(c.warehouse_expenses ?? 0);
      const cost = costBuy + costWarehouse;

      const sale = nmId != null ? salesByNm.get(nmId) : undefined;
      const adSpend = nmId != null ? adByNm.get(nmId) ?? 0 : 0;
      const units = sale?.units ?? 0;
      const revenue = sale?.revenue ?? 0;
      const forPay = sale?.forPay ?? 0;
      const factProfit = units > 0 ? forPay - cost * units - adSpend : null;
      const factMarginPct = factProfit !== null && revenue > 0 ? (factProfit / revenue) * 100 : null;

      return {
        article,
        name: (c.name as string) ?? null,
        nmId,
        cost,
        costBuy,
        costWarehouse,
        units,
        revenue,
        forPay,
        adSpend,
        factProfit,
        factMarginPct,
      };
    });

    products.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));
    return NextResponse.json({ data: products, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }
}
