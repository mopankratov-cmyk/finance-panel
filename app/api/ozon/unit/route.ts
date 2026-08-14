import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { ozonPrices, ozonImages, ozonAnalytics, ozonStocks, ozonPostings, ozonRealization } from "@/lib/ozon/api";
import { createOzonCostResolver } from "@/lib/ozon/costs";
import { indexOzonOfferIdsBySku, resolveOzonOfferId } from "@/lib/ozon/productIdentity";

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

  const [pricesRes, an, imgs, stocks] = await Promise.all([
    ozonPrices(cab.creds),
    ozonAnalytics(cab.creds, from, to),
    ozonImages(cab.creds),
    ozonStocks(cab.creds),
  ]);
  if (!pricesRes.ok) return NextResponse.json({ rows: [], error: pricesRes.error }, { status: 502 });

  // себес + реклама
  const db = getSupabaseAdmin();
  // реклама по SKU за 14 дней — из общего кэша ozon_ad_cache (тот же источник, что РНП)
  const adBySku: Record<string, number> = {};
  if (db) {
    const { data: adCache } = await db
      .from("ozon_ad_cache")
      .select("sku, spent")
      .eq("days", WINDOW_DAYS)
      .eq("client_id", cab.creds.clientId);
    for (const r of adCache ?? []) adBySku[r.sku as string] = Number(r.spent ?? 0);
  }
  let costs = createOzonCostResolver([]);
  if (db) {
    const { data } = await db.from("product_costs").select("article, name, cost_rub");
    costs = createOzonCostResolver(data ?? []);
  }

  // реализация по offer: выручка, заказы, реклама — через sku→offer
  const skuToOffer = imgs.skuToOffer;
  const stockOfferBySku = indexOzonOfferIdsBySku(stocks.ok ? stocks.rows : []);
  const revByOffer: Record<string, number> = {}, unitsByOffer: Record<string, number> = {}, adByOffer: Record<string, number> = {};
  const nameByOffer = new Map<string, string>();
  if (an.ok) for (const row of an.rows) {
    const offer = resolveOzonOfferId(row.sku, skuToOffer, stockOfferBySku); if (!offer) continue;
    revByOffer[offer] = (revByOffer[offer] ?? 0) + row.revenue;
    unitsByOffer[offer] = (unitsByOffer[offer] ?? 0) + row.ordered_units;
    if (row.name && !nameByOffer.has(offer)) nameByOffer.set(offer, row.name);
  }
  if (stocks.ok) for (const row of stocks.rows) {
    if (row.name && !nameByOffer.has(row.article)) nameByOffer.set(row.article, row.name);
  }
  for (const [sku, spent] of Object.entries(adBySku)) {
    const offer = resolveOzonOfferId(sku, skuToOffer, stockOfferBySku); if (!offer) continue;
    adByOffer[offer] = (adByOffer[offer] ?? 0) + spent;
  }

  const rows = pricesRes.rows.map((p) => {
    const off = p.offer_id;
    const units = unitsByOffer[off] ?? 0;
    // реальная цена продажи = выручка/заказы; если продаж нет — каталожная
    const price = units > 0 ? Math.round((revByOffer[off] ?? 0) / units) : Math.round(p.price);
    const productName = nameByOffer.get(off) ?? "";
    const costMatch = costs.resolve({ offerId: off, names: [productName] });
    const cost = costMatch?.cost ?? 0;
    const commissionRub = Math.round((price * p.commissionPct) / 100);
    const logistics = Math.round(p.logistics);
    const acquiring = Math.round(p.acquiring);
    const adPerUnit = units > 0 ? Math.round((adByOffer[off] ?? 0) / units) : 0;
    const drr = price > 0 ? Math.round((adPerUnit / price) * 1000) / 10 : 0;
    const taxRub = Math.round((price * taxPct) / 100);
    const profit = Math.round(price - cost - commissionRub - logistics - acquiring - adPerUnit - taxRub);
    const margin = price > 0 ? Math.round((profit / price) * 1000) / 10 : null;
    return {
      art: off, product_id: p.product_id, name: productName || costMatch?.name || off, img_url: imgs.byOffer[off] ?? null,
      price, cost: Math.round(cost), units,
      catalog_price: Math.round(p.price),
      marketing_price: Math.round(p.marketingPrice),
      marketing_seller_price: Math.round(p.marketingSellerPrice),
      commission_pct: p.commissionPct, commission_rub: commissionRub,
      logistics, acquiring, ad: adPerUnit, drr, tax: taxRub,
      profit, margin,
    };
  }).filter((x) => x.price > 0)
    .sort((a, b) => {
      if ((a.cost > 0) !== (b.cost > 0)) return a.cost > 0 ? -1 : 1;
      return (b.margin ?? -999) - (a.margin ?? -999);
    });

  // Временная диагностика: какие поля цен Ozon реально присылает.
  // В прайсе кабинета цены покупателя нет — ищем её в финансовом блоке отправлений.
  const priceFieldsSample = pricesRes.rows.filter((p) => p.rawPrice).slice(0, 3)
    .map((p) => ({ offer: p.offer_id, price: p.rawPrice }));
  let postingFinanceSample: unknown = null;
  try {
    const probeFrom = new Date(Date.now() - 3 * 86400000).toISOString();
    const probe = await ozonPostings(cab.creds, probeFrom, new Date().toISOString());
    const withFinance = probe.postings.flatMap((posting) => posting.products)
      .filter((product) => product.finance).slice(0, 3);
    postingFinanceSample = {
      отправлений: probe.postings.length,
      ошибки: probe.errors,
      позиции: withFinance.map((product) => ({
        offer: product.offerId,
        цена_в_products: product.price,
        финблок: product.finance?.raw,
      })),
    };
  } catch (error) {
    postingFinanceSample = { ошибка: String(error).slice(0, 200) };
  }
  // Отчёт о реализации — последнее место, где Ozon может показать цену покупателя.
  let realizationSample: unknown = null;
  try {
    const now = new Date();
    const probe = await ozonRealization(cab.creds, now.getUTCFullYear(), now.getUTCMonth() + 1);
    realizationSample = probe.ok
      ? {
        строк: probe.rows.length,
        позиции: probe.rows.slice(0, 5).map((row) => ({
          offer: row.offerId,
          штук: row.quantity,
          цена_покупателя: row.pricePerInstance,
          цена_продавца: row.sellerPricePerInstance,
        })),
        сырьё: probe.rawSample,
      }
      : { ошибка: probe.error };
  } catch (error) {
    realizationSample = { ошибка: String(error).slice(0, 200) };
  }
  return NextResponse.json({ cabinet: cab.name, taxPct, rows, count: rows.length, priceFieldsSample, postingFinanceSample, realizationSample });
}
