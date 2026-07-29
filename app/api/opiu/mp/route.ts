import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { loadWbCachedFinance } from "@/lib/finance/wbCachedFinance";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { ozonAnalytics, ozonImages, ozonTransactionTotals } from "@/lib/ozon/api";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (value: unknown) => Number(value ?? 0) || 0;
const r0 = (value: number) => Math.round(value);

// Общий ОПиУ WB+Ozon. WB читается из почасового факта синхронизации, а Ozon
// агрегируется по выбранному кабинету, группе или честному контуру «все».
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const weeks = Math.min(8, Math.max(1, Number(sp.get("weeks")) || 4));
  const taxParam = sp.get("tax");
  const taxPct = taxParam !== null && Number.isFinite(Number(taxParam)) ? Number(taxParam) : 7;
  const wbCabinetId = cabinetIdFromParam(sp.get("wb_cabinet"));
  if (!(await hasCabinetAccess(wbCabinetId))) {
    return NextResponse.json({ error: "Нет доступа к WB-кабинету" }, { status: 403 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const costByArt = new Map<string, number>();
  const costs = await db.from("product_costs").select("article, cost_rub");
  if (costs.error) return NextResponse.json({ error: costs.error.message }, { status: 502 });
  for (const row of costs.data ?? []) costByArt.set(String(row.article || "").trim().toUpperCase(), num(row.cost_rub));

  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString().slice(0, 10);

  const wbPromise = loadWbCachedFinance({ dateFrom: from, dateTo: to, cabinetId: wbCabinetId, taxPct })
    .then((value) => ({
      revenue_before_spp: value.revenueBeforeSpp,
      coinvest: 0,
      revenue: value.revenue,
      commission: value.commission,
      logistics: 0,
      storage: 0,
      penalty: 0,
      acquiring: value.acquiring,
      ad: value.ad,
      other: value.marketplaceOther,
      cogs: value.cogs,
      tax: value.tax,
      profit: value.profit,
      margin: value.margin,
      units: value.units,
      payout: value.payout,
      returns: value.returns,
      source: value.source,
      updatedAt: value.updatedAt,
      warnings: value.warnings,
    }))
    .catch((error) => ({ error: error instanceof Error ? error.message : "Не удалось загрузить WB" }));

  const ozonPromise = (async () => {
    const resolved = await getOzonCabinetScope(sp.get("cabinet"));
    if (!resolved.ok) return { error: resolved.error, noCabinet: true };
    const results = await Promise.all(resolved.scope.cabinets.map(async (cabinet) => {
      const totals = await ozonTransactionTotals(cabinet.creds, new Date(from).toISOString(), new Date(to).toISOString());
      if (!totals.ok) return { cabinet: cabinet.name, ok: false as const, error: totals.error };
      const [analytics, images] = await Promise.all([
        ozonAnalytics(cabinet.creds, from, to),
        ozonImages(cabinet.creds),
      ]);
      let cogs = 0;
      if (analytics.ok) {
        for (const row of analytics.rows) {
          const offer = images.skuToOffer[row.sku];
          cogs += (offer ? costByArt.get(offer.trim().toUpperCase()) ?? 0 : 0) * num(row.ordered_units);
        }
      }
      return { cabinet: cabinet.name, ok: true as const, totals: totals.totals, cogs, analyticsError: analytics.ok ? null : analytics.error };
    }));
    const ready = results.filter((result): result is Extract<(typeof results)[number], { ok: true }> => result.ok);
    if (!ready.length) {
      return { error: results.map((result) => `${result.cabinet}: ${result.ok ? "нет данных" : result.error}`).join("; ") || "Ozon не вернул данные" };
    }
    let revenue = 0;
    let commission = 0;
    let delivery = 0;
    let services = 0;
    let cogs = 0;
    for (const result of ready) {
      revenue += num(result.totals.accruals_for_sale);
      commission += Math.abs(num(result.totals.sale_commission));
      delivery += Math.abs(num(result.totals.processing_and_delivery));
      services += Math.abs(num(result.totals.services_amount));
      cogs += result.cogs;
    }
    const tax = revenue * taxPct / 100;
    const profit = revenue - commission - delivery - services - cogs - tax;
    const warnings = results.flatMap((result) => result.ok
      ? result.analyticsError ? [`${result.cabinet}: ${result.analyticsError}`] : []
      : [`${result.cabinet}: ${result.error}`]);
    return {
      revenue: r0(revenue),
      commission: r0(commission),
      delivery: r0(delivery),
      services: r0(services),
      cogs: r0(cogs),
      tax: r0(tax),
      profit: r0(profit),
      margin: revenue > 0 ? Math.round((profit / revenue) * 1_000) / 10 : 0,
      scope: resolved.scope.mode,
      cabinets: ready.map((result) => result.cabinet),
      warnings,
    };
  })();

  const [wb, ozon] = await Promise.all([wbPromise, ozonPromise]);
  return NextResponse.json({ period: { from, to, weeks }, taxPct, wb, ozon });
}
