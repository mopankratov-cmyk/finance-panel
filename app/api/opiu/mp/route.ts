import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { OPIU_BRANDS } from "@/lib/opiu/constants";
import { loadOpiuSalePeriod } from "@/lib/opiu/loadMonth";
import { monthlyWbActualFromOpiu } from "@/lib/opiu/monthlyWbActual";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { ozonAnalytics, ozonImages, ozonTransactionTotals } from "@/lib/ozon/api";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { marketplaceCabinetIdsForCompany } from "@/lib/opiu/companyScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (value: unknown) => Number(value ?? 0) || 0;
const r0 = (value: number) => Math.round(value);

// Общий ОПиУ WB+Ozon. WB читается из синхронизированного финансового отчёта,
// Ozon агрегируется по честному контуру доступных кабинетов.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const now = new Date();
  const fallbackMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const requestedMonth = sp.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : fallbackMonth;
  const [year, monthNumber] = month.split("-").map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const to = `${month}-${String(lastDay).padStart(2, "0")}`;
  const taxPct = 0;
  const requestedCompanyId = sp.get("company")?.trim() || null;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  let companyCabinetIds: Set<string> | null = null;
  if (requestedCompanyId) {
    const companyResult = await db.from("companies").select("id,name,is_active").eq("id", requestedCompanyId).maybeSingle();
    if (companyResult.error) return NextResponse.json({ error: companyResult.error.message }, { status: 502 });
    if (!companyResult.data?.is_active) return NextResponse.json({ error: "Компания не найдена" }, { status: 400 });
    const [entitiesResult, linksResult] = await Promise.all([
      db.from("legal_entities").select("id,name"),
      db.from("legal_entity_cabinets").select("legal_entity_id,cabinet_id"),
    ]);
    if (entitiesResult.error || linksResult.error) {
      return NextResponse.json({ error: entitiesResult.error?.message ?? linksResult.error?.message ?? "Связи компаний не загружены" }, { status: 502 });
    }
    companyCabinetIds = marketplaceCabinetIdsForCompany(
      String(companyResult.data.name),
      (entitiesResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })),
      (linksResult.data ?? []).map((row) => ({ legalEntityId: String(row.legal_entity_id), cabinetId: String(row.cabinet_id) })),
    );
  }
  const wbCabinetIds = [...new Set(OPIU_BRANDS.map((brand) => brand.cabinetId))];
  const accessPairs = await Promise.all(wbCabinetIds.map(async (cabinetId) => [cabinetId, await hasCabinetAccess(cabinetId)] as const));
  const accessByCabinet = new Map(accessPairs);
  const accessibleBrandIds = OPIU_BRANDS
    .filter((brand) => accessByCabinet.get(brand.cabinetId) && (!companyCabinetIds || companyCabinetIds.has(brand.cabinetId)))
    .map((brand) => brand.id);

  const costByArt = new Map<string, number>();
  const costs = await db.from("product_costs").select("article, cost_rub");
  if (costs.error) return NextResponse.json({ error: costs.error.message }, { status: 502 });
  for (const row of costs.data ?? []) costByArt.set(String(row.article || "").trim().toUpperCase(), num(row.cost_rub));

  const wbPromise = accessibleBrandIds.length
    ? loadOpiuSalePeriod(from, to, accessibleBrandIds)
      .then(monthlyWbActualFromOpiu)
      .catch((error) => ({ error: error instanceof Error ? error.message : "Не удалось загрузить WB" }))
    : Promise.resolve({ error: "Нет доступа к кабинетам WB из состава ОПиУ" });

  const ozonPromise = (async () => {
    const resolved = await getOzonCabinetScope(companyCabinetIds ? "all" : sp.get("cabinet"));
    if (!resolved.ok) return { error: resolved.error, noCabinet: true };
    const ozonCabinets = companyCabinetIds
      ? resolved.scope.cabinets.filter((cabinet) => companyCabinetIds.has(cabinet.id))
      : resolved.scope.cabinets;
    if (!ozonCabinets.length) return { error: "У компании нет связанного кабинета Ozon", noCabinet: true };
    const results = await Promise.all(ozonCabinets.map(async (cabinet) => {
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
  return NextResponse.json({ period: { from, to, month }, wb, ozon });
}
