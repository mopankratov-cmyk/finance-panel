import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { ozonPrices, ozonImages, ozonAnalytics, ozonStocks } from "@/lib/ozon/api";
import { buyerDiscountForOffer, loadOzonBuyerDiscount, taxableOzonPrice } from "@/lib/ozon/buyerDiscount";
import { createOzonCostResolver } from "@/lib/ozon/costs";
import { indexOzonOfferIdsBySku, resolveOzonOfferId } from "@/lib/ozon/productIdentity";
import { loadCabinetUnitSetting, resolveExtraCommissionPct, resolveTaxPct } from "@/lib/unit/cabinetSettings";
import { UNIT_DEFAULT_TAX_PCT } from "@/lib/unit/query";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ozon юнит-экономика (ЧИСТАЯ): цена продажи = выручка/заказы (реальная, не каталожная),
// минус комиссия, логистика, эквайринг, РЕКЛАМА (ДРР×цена), НАЛОГ (%), себес.
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const taxParam = sp.get("tax");
  const requestedTaxPct = taxParam !== null && Number.isFinite(Number(taxParam)) ? Number(taxParam) : null;
  const extraParam = sp.get("extra");
  const requestedExtraPct = extraParam !== null && Number.isFinite(Number(extraParam)) ? Number(extraParam) : null;
  const cabinetParam = sp.get("cabinet");
  const cab = await getActiveOzonCreds(cabinetParam);
  if (!cab.ok) return NextResponse.json({ rows: [], error: cab.error, noCabinet: true });

  const WINDOW_DAYS = 14; // окно реализации/рекламы (кэш рекламы стабилен на 14д)
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

  const [pricesRes, an, imgs, stocks, buyerDiscount] = await Promise.all([
    ozonPrices(cab.creds),
    ozonAnalytics(cab.creds, from, to),
    ozonImages(cab.creds),
    ozonStocks(cab.creds),
    loadOzonBuyerDiscount(cab.creds),
  ]);
  if (!pricesRes.ok) return NextResponse.json({ rows: [], error: pricesRes.error }, { status: 502 });

  // себес + реклама
  const db = getSupabaseAdmin();
  // Налог и комиссия посредника — ручные настройки кабинета; параметр запроса их
  // перебивает, чтобы на экране можно было посчитать «а что если».
  const settings = db ? await loadCabinetUnitSetting(db, cab.id).catch(() => null) : null;
  const tax = resolveTaxPct({ requested: requestedTaxPct, cabinet: settings?.taxPct ?? null, fallback: UNIT_DEFAULT_TAX_PCT });
  const extraCommission = resolveExtraCommissionPct({ requested: requestedExtraPct, cabinet: settings?.extraCommissionPct ?? null });
  const taxPct = tax.taxPct;
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
    // Прайсовая цена рядом с фактической: у пеналов прайс 1 990 ₽ при
    // фактической продаже по 300 ₽, и без этой пары непонятно, что показано.
    const listPrice = Math.round(p.price);
    const productName = nameByOffer.get(off) ?? "";
    const costMatch = costs.resolve({ offerId: off, names: [productName] });
    const cost = costMatch?.cost ?? 0;
    const commissionRub = Math.round((price * p.commissionPct) / 100);
    // Комиссия посредника считается с цены продавца — как и комиссия площадки.
    const extraCommissionRub = Math.round((price * extraCommission.extraCommissionPct) / 100);
    const logistics = Math.round(p.logistics);
    const acquiring = Math.round(p.acquiring);
    const adPerUnit = units > 0 ? Math.round((adByOffer[off] ?? 0) / units) : 0;
    const drr = price > 0 ? Math.round((adPerUnit / price) * 1000) / 10 : 0;
    // Налог — с того, что заплатил покупатель: цена продавца минус скидка Ozon.
    // Комиссия, логистика и эквайринг остаются на цене продавца: Ozon считает их от неё.
    const discountShare = buyerDiscountForOffer(buyerDiscount, off);
    const buyerPrice = taxableOzonPrice(price, discountShare);
    const taxRub = Math.round((buyerPrice * taxPct) / 100);
    const profit = Math.round(price - cost - commissionRub - logistics - acquiring - extraCommissionRub - adPerUnit - taxRub);
    const margin = price > 0 ? Math.round((profit / price) * 1000) / 10 : null;
    return {
      art: off, product_id: p.product_id, name: productName || costMatch?.name || off, img_url: imgs.byOffer[off] ?? null,
      price, list_price: listPrice, price_source: units > 0 ? "fact" : "list", cost: Math.round(cost), units,
      // Цена покупателя пустая, если отчёт о реализации по этому товару фактов не дал.
      buyer_price: discountShare == null ? null : Math.round(buyerPrice),
      ozon_discount_pct: discountShare == null ? null : Math.round(discountShare * 1000) / 10,
      commission_pct: p.commissionPct, commission_rub: commissionRub,
      extra_commission: extraCommission.extraCommissionPct > 0 ? extraCommissionRub : null,
      logistics, acquiring, ad: adPerUnit, drr, tax: taxRub,
      profit, margin,
    };
  }).filter((x) => x.price > 0)
    .sort((a, b) => {
      if ((a.cost > 0) !== (b.cost > 0)) return a.cost > 0 ? -1 : 1;
      return (b.margin ?? -999) - (a.margin ?? -999);
    });

  return NextResponse.json({
    cabinet: cab.name,
    cabinetId: cab.id,
    taxPct,
    taxSource: tax.source,
    extraCommissionPct: extraCommission.extraCommissionPct,
    extraCommissionSource: extraCommission.source,
    rows,
    count: rows.length,
    // Из каких отчётов собрана скидка: реализация по дням свежее, закрытые месяцы
    // добирают остальное. Показываем источники, чтобы лаг был виден, а не подразумевался.
    buyerDiscountSources: buyerDiscount.sources,
    buyerDiscountCovered: buyerDiscount.covered,
  });
}
