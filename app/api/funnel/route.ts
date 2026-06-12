import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export interface FunnelRow {
  nmId: number;
  article: string;
  openCard: number;
  addToCart: number;
  orders: number;
  ordersSum: number;
  buyouts: number;
  buyoutSum: number;
  /** корзина ÷ показы */
  cartRate: number | null;
  /** заказы ÷ корзина */
  orderRate: number | null;
  /** выкупы ÷ заказы */
  buyoutRate: number | null;
}

export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const days = searchParams.get("period") === "yesterday" ? 1 : 7;

  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - 1);
  const begin = new Date(end);
  begin.setDate(begin.getDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const [funnelRes, articlesRes] = await Promise.all([
      db
        .from("wb_funnel_daily")
        .select("nm_id, open_card, add_to_cart, orders, orders_sum, buyouts, buyout_sum")
        .gte("date", fmt(begin))
        .lte("date", fmt(end)),
      db
        .from("wb_orders")
        .select("nm_id, supplier_article")
        .gte("date", new Date(Date.now() - 30 * 86400000).toISOString())
        .not("supplier_article", "is", null)
        .limit(1000),
    ]);

    if (funnelRes.error) throw new Error(funnelRes.error.message);

    const articles = new Map<number, string>();
    for (const r of articlesRes.data ?? []) {
      if (!articles.has(r.nm_id)) articles.set(r.nm_id, r.supplier_article);
    }

    const byNm = new Map<number, FunnelRow>();
    for (const r of funnelRes.data ?? []) {
      let row = byNm.get(r.nm_id);
      if (!row) {
        row = {
          nmId: r.nm_id,
          article: articles.get(r.nm_id) ?? "",
          openCard: 0,
          addToCart: 0,
          orders: 0,
          ordersSum: 0,
          buyouts: 0,
          buyoutSum: 0,
          cartRate: null,
          orderRate: null,
          buyoutRate: null,
        };
        byNm.set(r.nm_id, row);
      }
      row.openCard += r.open_card ?? 0;
      row.addToCart += r.add_to_cart ?? 0;
      row.orders += r.orders ?? 0;
      row.ordersSum += Number(r.orders_sum ?? 0);
      row.buyouts += r.buyouts ?? 0;
      row.buyoutSum += Number(r.buyout_sum ?? 0);
    }

    const rows = [...byNm.values()].map((r) => ({
      ...r,
      cartRate: r.openCard > 0 ? (r.addToCart / r.openCard) * 100 : null,
      orderRate: r.addToCart > 0 ? (r.orders / r.addToCart) * 100 : null,
      buyoutRate: r.orders > 0 ? (r.buyouts / r.orders) * 100 : null,
    }));

    rows.sort((a, b) => b.ordersSum - a.ordersSum);
    return NextResponse.json({ data: rows, error: null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ data: null, error: msg }, { status: 500 });
  }
}
