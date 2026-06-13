import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { ozonPrices, ozonImages, ozonAnalytics } from "@/lib/ozon/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ozon юнит-экономика (ЧИСТАЯ): цена продажи = выручка/заказы (реальная, не каталожная),
// минус комиссия, логистика, эквайринг, РЕКЛАМА (ДРР×цена), НАЛОГ (%), себес.
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const taxParam = sp.get("tax");
  const taxPct = taxParam !== null && Number.isFinite(Number(taxParam)) ? Number(taxParam) : 7;
  const cab = await getActiveOzonCreds(sp.get("cabinet"));
  if (!cab.ok) return NextResponse.json({ rows: [], error: cab.error, noCabinet: true });

  const WINDOW_DAYS = 14; // окно реализации/рекламы (кэш рекламы стабилен на 14д)
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

  const [pricesRes, an, imgs] = await Promise.all([
    ozonPrices(cab.creds),
    ozonAnalytics(cab.creds, from, to),
    ozonImages(cab.creds),
  ]);
  if (!pricesRes.ok) return NextResponse.json({ rows: [], error: pricesRes.error }, { status: 502 });

  // себес + реклама
  const db = getSupabaseAdmin();
  // реклама по SKU за 30дн — из общего кэша ozon_ad_cache (тот же источник, что РНП)
  const adBySku: Record<string, number> = {};
  if (db) {
    const { data: adCache } = await db.from("ozon_ad_cache").select("sku, spent").eq("days", WINDOW_DAYS);
    for (const r of adCache ?? []) adBySku[r.sku as string] = Number(r.spent ?? 0);
  }
  const costByArt = new Map<string, number>();
  const nameByArt = new Map<string, string>();
  if (db) {
    const { data } = await db.from("product_costs").select("article, name, cost_rub");
    for (const c of data ?? []) { costByArt.set(c.article as string, Number(c.cost_rub ?? 0)); nameByArt.set(c.article as string, (c.name as string) ?? ""); }
  }

  // реализация по offer: выручка, заказы, реклама — через sku→offer
  const skuToOffer = imgs.skuToOffer;
  const revByOffer: Record<string, number> = {}, unitsByOffer: Record<string, number> = {}, adByOffer: Record<string, number> = {};
  if (an.ok) for (const row of an.rows) {
    const offer = skuToOffer[row.sku]; if (!offer) continue;
    revByOffer[offer] = (revByOffer[offer] ?? 0) + row.revenue;
    unitsByOffer[offer] = (unitsByOffer[offer] ?? 0) + row.ordered_units;
  }
  for (const [sku, spent] of Object.entries(adBySku)) {
    const offer = skuToOffer[sku]; if (!offer) continue;
    adByOffer[offer] = (adByOffer[offer] ?? 0) + spent;
  }

  const rows = pricesRes.rows.map((p) => {
    const off = p.offer_id;
    const units = unitsByOffer[off] ?? 0;
    // реальная цена продажи = выручка/заказы; если продаж нет — каталожная
    const price = units > 0 ? Math.round((revByOffer[off] ?? 0) / units) : Math.round(p.price);
    const cost = costByArt.get(off) ?? 0;
    const commissionRub = Math.round((price * p.commissionPct) / 100);
    const logistics = Math.round(p.logistics);
    const acquiring = Math.round(p.acquiring);
    const adPerUnit = units > 0 ? Math.round((adByOffer[off] ?? 0) / units) : 0;
    const drr = price > 0 ? Math.round((adPerUnit / price) * 1000) / 10 : 0;
    const taxRub = Math.round((price * taxPct) / 100);
    const profit = Math.round(price - cost - commissionRub - logistics - acquiring - adPerUnit - taxRub);
    const margin = price > 0 ? Math.round((profit / price) * 1000) / 10 : null;
    return {
      art: off, product_id: p.product_id, name: nameByArt.get(off) || off, img_url: imgs.byOffer[off] ?? null,
      price, cost: Math.round(cost), units,
      commission_pct: p.commissionPct, commission_rub: commissionRub,
      logistics, acquiring, ad: adPerUnit, drr, tax: taxRub,
      profit, margin,
    };
  }).filter((x) => x.price > 0)
    .sort((a, b) => {
      if ((a.cost > 0) !== (b.cost > 0)) return a.cost > 0 ? -1 : 1;
      return (b.margin ?? -999) - (a.margin ?? -999);
    });

  return NextResponse.json({ cabinet: cab.name, taxPct, rows, count: rows.length });
}
