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

  const funnel = (funnelRes.data ?? []) as FunnelRow[];
  const ad = (adRes.data ?? []) as AdRow[];
  const dates = [...new Set([...funnel, ...ad].map((r) => String(r.date).slice(0, 10)))].sort();
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
    for (const f of funnel) if (f.nm_id === nm && has(String(f.date).slice(0, 10))) { cart += f.add_to_cart || 0; oc += f.orders || 0; os += Number(f.orders_sum || 0); open += f.open_card || 0; }
    for (const a of ad) if (a.nm_id === nm && has(String(a.date).slice(0, 10))) { views += a.views || 0; clicks += a.clicks || 0; spent += Number(a.spent || 0); }
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
