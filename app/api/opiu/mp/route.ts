import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { ozonTransactionTotals, ozonAnalytics, ozonImages } from "@/lib/ozon/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WB_STATS_TOKEN = process.env.WB_STATS_TOKEN || process.env.WB_TOKEN_STATISTICS;
const num = (v: unknown) => Number(v ?? 0) || 0;
const r0 = (v: number) => Math.round(v);

interface WbRow {
  supplier_oper_name?: string; sa_name?: string; quantity?: number;
  retail_price_withdisc_rub?: number; ppvz_for_pay?: number;
  installment_cofinancing_amount?: number; delivery_rub?: number; storage_fee?: number;
  penalty?: number; acquiring_fee?: number; deduction?: number; bonus_type_name?: string;
}

// Общий ОПиУ WB+Ozon. База выручки WB — до СПП (retail_price_withdisc_rub) + соинвест.
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const weeks = Math.min(8, Math.max(1, Number(sp.get("weeks")) || 4));
  const taxParam = sp.get("tax");
  const taxPct = taxParam !== null && Number.isFinite(Number(taxParam)) ? Number(taxParam) : 7;

  const db = getSupabaseAdmin();
  const costByArt = new Map<string, number>();
  if (db) {
    const { data } = await db.from("product_costs").select("article, cost_rub");
    for (const c of data ?? []) costByArt.set(String(c.article).toUpperCase(), num(c.cost_rub));
  }

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - weeks * 7 * 86400000).toISOString().slice(0, 10);

  // ---------- WB (финотчёт, база до СПП) ----------
  let wb: Record<string, number> | { error: string } = { error: "WB_STATS_TOKEN не настроен" };
  if (WB_STATS_TOKEN) {
    try {
      const res = await fetch(`https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=${from}&dateTo=${to}&limit=100000&rrdid=0`, { headers: { Authorization: WB_STATS_TOKEN }, next: { revalidate: 3600 } });
      if (!res.ok) wb = { error: `WB ${res.status}` };
      else {
        const rows = (await res.json()) as WbRow[];
        // комиссия WB = (выручка до СПП − выплата продавцу − эквайринг) по продажам ≈ реальные ~30%
        // (ppvz_sales_commission занижен; WB компенсирует СПП, поэтому база — до СПП)
        let revBeforeSpp = 0, salePayout = 0, saleAcq = 0, coinvest = 0, logistics = 0, storage = 0, penalty = 0, acquiring = 0, ad = 0, otherDed = 0, cogs = 0, units = 0;
        for (const x of rows) {
          const op = x.supplier_oper_name ?? "";
          if (op === "Продажа") {
            const q = num(x.quantity);
            revBeforeSpp += num(x.retail_price_withdisc_rub) * q;
            salePayout += num(x.ppvz_for_pay);
            saleAcq += num(x.acquiring_fee);
            const sa = (x.sa_name ?? "").trim().toUpperCase();
            const c = costByArt.get(sa) ?? costByArt.get(sa.split(/[ /\\]/)[0]) ?? 0;
            cogs += c * q;
            units += q;
          }
          coinvest += num(x.installment_cofinancing_amount);
          logistics += num(x.delivery_rub);
          storage += num(x.storage_fee);
          penalty += num(x.penalty);
          acquiring += num(x.acquiring_fee);
          const d = num(x.deduction);
          if (d) { const bt = (x.bonus_type_name ?? "").toLowerCase(); if (bt.includes("продвижени") || bt.includes("реклам")) ad += d; else otherDed += d; }
        }
        const commission = Math.max(0, revBeforeSpp - salePayout - saleAcq);
        const revenue = revBeforeSpp + coinvest;
        const tax_rub = revenue * (taxPct / 100);
        const costs = commission + logistics + storage + penalty + acquiring + ad + otherDed + cogs + tax_rub;
        const profit = revenue - costs;
        wb = {
          revenue_before_spp: r0(revBeforeSpp), coinvest: r0(coinvest), revenue: r0(revenue),
          commission: r0(commission), logistics: r0(logistics), storage: r0(storage), penalty: r0(penalty),
          acquiring: r0(acquiring), ad: r0(ad), other: r0(otherDed), cogs: r0(cogs), tax: r0(tax_rub),
          profit: r0(profit), margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0, units,
        };
      }
    } catch (e) { wb = { error: String(e).slice(0, 80) }; }
  }

  // ---------- Ozon (transaction totals + аналитика для себеса) ----------
  let ozon: Record<string, number> | { error: string; noCabinet?: boolean } = { error: "Нет Ozon-кабинета", noCabinet: true };
  const cab = await getActiveOzonCreds(sp.get("cabinet"));
  if (cab.ok) {
    const t = await ozonTransactionTotals(cab.creds, new Date(from).toISOString(), new Date(to).toISOString());
    if (!t.ok) ozon = { error: t.error };
    else {
      const tot = t.totals;
      // себес: ordered_units по SKU × cost; sku→offer_id (ozonImages) → cost (product_costs)
      let cogs = 0;
      const [an, imgs] = await Promise.all([ozonAnalytics(cab.creds, from, to), ozonImages(cab.creds)]);
      if (an.ok) {
        for (const row of an.rows) {
          const offer = imgs.skuToOffer[row.sku];
          const cost = offer ? (costByArt.get(offer) ?? 0) : 0;
          cogs += cost * num(row.ordered_units);
        }
      }
      const revenue = num(tot.accruals_for_sale);
      const commission = Math.abs(num(tot.sale_commission));
      const delivery = Math.abs(num(tot.processing_and_delivery));
      const services = Math.abs(num(tot.services_amount));
      const tax_rub = revenue * (taxPct / 100);
      const costs = commission + delivery + services + cogs + tax_rub;
      const profit = revenue - costs;
      ozon = {
        revenue: r0(revenue), commission: r0(commission), delivery: r0(delivery), services: r0(services),
        cogs: r0(cogs), tax: r0(tax_rub), profit: r0(profit), margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
      };
    }
  }

  return NextResponse.json({ period: { from, to, weeks }, taxPct, wb, ozon });
}
