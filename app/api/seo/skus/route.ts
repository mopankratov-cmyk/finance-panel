import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FunnelRow { nm_id: number; date: string; open_card: number; add_to_cart: number; orders: number; orders_sum: number }
interface AdRow { nm_id: number; date: string; views: number; clicks: number; spent: number }
interface RpcTotal { nm_id: number; article: string; stock: number; cost: number | null }

const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (num: number, den: number) => (den > 0 ? r2((num / den) * 100) : null);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const ruDate = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;

function windowDays(raw: string | null): number {
  if (raw === "1" || raw === "yesterday") return 1;
  if (raw === "30" || raw === "month" || raw === "1m") return 30;
  return 7;
}

function selectedPeriod(days: number) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return { start: iso(start), end: iso(end), label: days === 1 ? ruDate(iso(end)) : `${ruDate(iso(start))}-${ruDate(iso(end))}` };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
// Произвольный диапазон (?date_from=&date_to=) в дополнение к пресетам ?window=1|7|30.
function customPeriod(from: string | null, to: string | null) {
  if (!from || !to || !ISO_RE.test(from) || !ISO_RE.test(to) || from > to) return null;
  return { start: from, end: to, label: `${ruDate(from)}-${ruDate(to)}` };
}

// Источник SKU для дизайн/«Воронка» (inferno loadDesign). Поля с суффиксом _7d (окно 7д) и _4d (вчера).
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ skus: [], metrics_period: "" });

  const params = new URL(request.url).searchParams;
  // Кабинет из ?cabinet=<uuid|all> — фильтруем все источники по нему (или все, если "all").
  const { cabinetId, label } = await resolveShopCabinet(params.get("cabinet") ?? undefined);
  const days = windowDays(params.get("window"));
  const period = customPeriod(params.get("date_from"), params.get("date_to")) ?? selectedPeriod(days);

  let funnelQ = db.from("wb_funnel_daily").select("nm_id, date, open_card, add_to_cart, orders, orders_sum").gte("date", period.start).lte("date", period.end);
  let adQ = db.from("wb_advert_nm_daily").select("nm_id, date, views, clicks, spent").gte("date", period.start).lte("date", period.end);
  if (cabinetId) { funnelQ = funnelQ.eq("cabinet_id", cabinetId); adQ = adQ.eq("cabinet_id", cabinetId); }
  const [funnelRes, adRes, totalsRes, costsRes] = await Promise.all([
    funnelQ,
    adQ,
    db.rpc("rnp_report", { p_cabinet: cabinetId }),
    db.from("product_costs").select("article, name"),
  ]);

  // Заказы по nm/день для выручки ДО СПП — через server-side агрегат rnp_daily_sku
  // (orders_sum = coalesce(finished_price, total_price) = цена после скидки продавца = до СПП).
  // Раньше тут шёл постраничный скан wb_orders по сети — рвал соединение и вис на 70с+.
  const ordersByNm = new Map<number, Map<string, { cnt: number; sum: number }>>();
  const { data: dailySku } = await db.rpc("rnp_daily_sku", { p_from: period.start, p_to: period.end, p_cabinet: cabinetId });
  for (const row of (dailySku ?? []) as { nm_id: number; d: string; orders_count: number; orders_sum: number }[]) {
    const nm = Number(row.nm_id);
    const d = String(row.d).slice(0, 10);
    if (!ordersByNm.has(nm)) ordersByNm.set(nm, new Map());
    ordersByNm.get(nm)!.set(d, { cnt: Number(row.orders_count ?? 0), sum: Number(row.orders_sum ?? 0) });
  }

  const funnel = (funnelRes.data ?? []) as FunnelRow[];
  const ad = (adRes.data ?? []) as AdRow[];
  const orderDates: string[] = [];
  for (const m of ordersByNm.values()) for (const d of m.keys()) orderDates.push(d);
  const dates = [...new Set([...funnel.map((r) => String(r.date).slice(0, 10)), ...ad.map((r) => String(r.date).slice(0, 10)), ...orderDates])].sort();
  const yest = period.end;
  const selected = new Set(dates.filter((d) => d >= period.start && d <= period.end));

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

    const w = agg(nm, selected);
    const y = agg(nm, "yest");

    const priceUnit = (a: typeof w) => (a.oc > 0 ? Math.round(a.os / a.oc) : 0);
    const margin = (a: typeof w) => { const p = priceUnit(a); return p > 0 && cost > 0 ? r2(((p - cost) / p) * 100) : null; };
    const turn = w.oc > 0 ? Math.round(stock / (w.oc / 7)) : null;

    const mb7 = margin(w), drr7 = pct(w.spent, w.os);
    const mb4 = margin(y), drr4 = pct(y.spent, y.os);

    return {
      nm, art, shop: label || "Магазин", img_url: wbCardImageUrl(nm),
      name: nameByArt.get(art) || art,
      // окно 7 дней
      shows_7d: w.views, opens_7d: w.clicks || w.open, clicks_7d: w.clicks, ctr_7d: pct(w.clicks, w.views), cart_7d: w.cart,
      cv_cart_7d: pct(w.cart, w.clicks || w.open), cv_order_7d: pct(w.oc, w.cart),
      orders_count_7d: w.oc, orders_sum_7d: Math.round(w.os),
      margin_before_drr_7d: mb7, drr_7d: drr7,
      // выбранное окно из ?window=1|7|30
      shows_window: w.views, opens_window: w.clicks || w.open, clicks_window: w.clicks, ctr_window: pct(w.clicks, w.views), cart_window: w.cart,
      cv_cart_window: pct(w.cart, w.clicks || w.open), cv_order_window: pct(w.oc, w.cart),
      orders_count_window: w.oc, orders_sum_window: Math.round(w.os),
      margin_before_drr_window: mb7, drr_window: drr7,
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

  return NextResponse.json({ skus, metrics_period: period.label, window_days: days, count: skus.length });
}
