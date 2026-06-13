import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FunnelRow { nm_id: number; date: string; open_card: number; add_to_cart: number; orders: number; orders_sum: number }
interface AdRow { nm_id: number; date: string; views: number; clicks: number; spent: number }
interface RpcTotal { nm_id: number; article: string; stock: number; cost: number | null }

const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? r2((num / den) * 100) : null);

// Источник SKU для дизайн/«Воронка» (inferno loadDesign). Поля с суффиксом _7d (окно 7д) и _4d (вчера).
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ skus: [], metrics_period: "" });

  const since = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const [funnelRes, adRes, totalsRes, costsRes] = await Promise.all([
    db.from("wb_funnel_daily").select("nm_id, date, open_card, add_to_cart, orders, orders_sum").gte("date", since),
    db.from("wb_advert_nm_daily").select("nm_id, date, views, clicks, spent").gte("date", since),
    db.rpc("rnp_report"),
    db.from("product_costs").select("article, name"),
  ]);

  // заказы из wb_orders для выручки ДО СПП (total_price×(1−disc%)) — постранично (cap 1000)
  const ordersByNm = new Map<number, Map<string, { cnt: number; sum: number }>>();
  for (let page = 0; page < 30; page++) {
    const { data, error } = await db
      .from("wb_orders").select("nm_id, date, total_price, discount_percent, is_cancel")
      .gte("date", since).range(page * 1000, page * 1000 + 999);
    if (error || !data?.length) break;
    for (const o of data) {
      if (o.is_cancel) continue;
      const nm = o.nm_id as number;
      const d = String(o.date).slice(0, 10);
      const beforeSpp = Number(o.total_price ?? 0) * (1 - Number(o.discount_percent ?? 0) / 100);
      if (!ordersByNm.has(nm)) ordersByNm.set(nm, new Map());
      const m = ordersByNm.get(nm)!;
      const e = m.get(d) ?? { cnt: 0, sum: 0 };
      e.cnt++; e.sum += beforeSpp;
      m.set(d, e);
    }
    if (data.length < 1000) break;
  }

  const funnel = (funnelRes.data ?? []) as FunnelRow[];
  const ad = (adRes.data ?? []) as AdRow[];
  const orderDates: string[] = [];
  for (const m of ordersByNm.values()) for (const d of m.keys()) orderDates.push(d);
  const dates = [...new Set([...funnel.map((r) => String(r.date).slice(0, 10)), ...ad.map((r) => String(r.date).slice(0, 10)), ...orderDates])].sort();
  const yest = dates[dates.length - 1] ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const week = new Set(dates.slice(-7));

  const totals = (totalsRes.data ?? []) as RpcTotal[];
  const totalByNm = new Map<number, RpcTotal>();
  for (const t of totals) totalByNm.set(t.nm_id, t);
  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");

  const nmIds = [...new Set([...funnel.map((r) => r.nm_id), ...ad.map((r) => r.nm_id), ...totals.map((t) => t.nm_id)])];

  const agg = (nm: number, days: Set<string> | "yest") => {
    let views = 0, clicks = 0, spent = 0, cart = 0, oc = 0, os = 0, open = 0;
    const has = (d: string) => (days === "yest" ? d === yest : days.has(d));
    // воронка (показы/корзина/открытия) — из аналитики WB
    for (const f of funnel) if (f.nm_id === nm && has(String(f.date).slice(0, 10))) { cart += f.add_to_cart || 0; open += f.open_card || 0; }
    for (const a of ad) if (a.nm_id === nm && has(String(a.date).slice(0, 10))) { views += a.views || 0; clicks += a.clicks || 0; spent += Number(a.spent || 0); }
    // заказы шт/₽ — из wb_orders ДО СПП
    const om = ordersByNm.get(nm);
    if (om) for (const [d, e] of om) if (has(d)) { oc += e.cnt; os += e.sum; }
    return { views, clicks, spent, cart, oc, os, open };
  };

  const skus = nmIds.map((nm) => {
    const t = totalByNm.get(nm);
    const art = t?.article || String(nm);
    const cost = Number(t?.cost ?? 0);
    const stock = Number(t?.stock ?? 0);

    const w = agg(nm, week);
    const y = agg(nm, "yest");

    const priceUnit = (a: typeof w) => (a.oc > 0 ? Math.round(a.os / a.oc) : 0);
    const margin = (a: typeof w) => { const p = priceUnit(a); return p > 0 && cost > 0 ? r2(((p - cost) / p) * 100) : null; };
    const turn = w.oc > 0 ? Math.round(stock / (w.oc / 7)) : null;

    const mb7 = margin(w), drr7 = pct(w.spent, w.os);
    const mb4 = margin(y), drr4 = pct(y.spent, y.os);

    return {
      nm, art, shop: "Магазин", img_url: wbCardImageUrl(nm),
      name: nameByArt.get(art) || art,
      // окно 7 дней
      shows_7d: w.views, opens_7d: w.clicks || w.open, ctr_7d: pct(w.clicks, w.views), cart_7d: w.cart,
      cv_cart_7d: pct(w.cart, w.clicks || w.open), cv_order_7d: pct(w.oc, w.cart),
      orders_count_7d: w.oc, orders_sum_7d: Math.round(w.os),
      margin_before_drr_7d: mb7, drr_7d: drr7,
      // окно вчера
      views_4d: y.views, clicks_4d: y.clicks, ctr_4d: pct(y.clicks, y.views), cart_4d: y.cart,
      orders_count_4d: y.oc, orders_sum_4d: Math.round(y.os),
      margin_pct_4d: mb4, sae_4d: drr4, profitability_4d: mb4 != null && drr4 != null ? r2(mb4 - drr4) : null,
      // общие
      price_before_spp_unit: priceUnit(w) || priceUnit(y),
      stock, turnover_4d: turn, rating: null, reviews: null,
    };
  }).filter((s) => s.shows_7d > 0 || s.orders_count_7d > 0 || s.stock > 0)
    .sort((a, b) => b.orders_sum_7d - a.orders_sum_7d);

  return NextResponse.json({ skus, metrics_period: "вчера", count: skus.length });
}
