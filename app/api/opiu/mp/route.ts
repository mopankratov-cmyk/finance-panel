import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { OPIU_BRANDS, type OpiuBrand } from "@/lib/opiu/constants";
import { loadOpiuSalePeriod } from "@/lib/opiu/loadMonth";
import { monthlyWbActualFromOpiu } from "@/lib/opiu/monthlyWbActual";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { ozonAnalytics, ozonImages, ozonTransactionTotals } from "@/lib/ozon/api";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildOpiuCompanyScopes, companyNamesMatch } from "@/lib/opiu/companyScope";
import {
  aggregateOzonSources,
  aggregateWbSources,
  coalesceWbSources,
  wbBrandCompanyName,
  type MonthlyMarketplaceSource,
} from "@/lib/opiu/monthlyMarketplaceSources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (value: unknown) => Number(value ?? 0) || 0;
const r0 = (value: number) => Math.round(value);

function failedWb(message: string): NonNullable<MonthlyMarketplaceSource["wb"]> {
  return { revenue_before_spp: 0, commission: 0, acquiring: 0, ad: 0, other: 0, cogs: 0, packaging: 0, logistics: 0, storage: 0, penalty: 0, error: message };
}

function failedOzon(message: string): NonNullable<MonthlyMarketplaceSource["ozon"]> {
  return { revenue: 0, commission: 0, delivery: 0, services: 0, cogs: 0, error: message, noCabinet: true };
}

function wbSourceLabel(brand: OpiuBrand, companyName: string | undefined, allCompanies: boolean): string {
  if (!allCompanies) return brand.articlePrefixes?.length ? `WB ${brand.label}` : "WB";
  if (brand.articlePrefixes?.length) return `WB ${brand.label}${companyName ? ` · ${companyName}` : ""}`;
  return `WB ${companyName ?? brand.label}`;
}

// Месячный ОПиУ использует тот же сверенный WB-финотчёт, но возвращает каждый
// кабинет/бренд отдельной колонкой. Суммарные wb/ozon сохранены для итогов.
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
  const requestedCompanyId = sp.get("company")?.trim() || null;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const [companiesResult, entitiesResult, linksResult, costsResult] = await Promise.all([
    db.from("companies").select("id,name,group_name,is_active"),
    db.from("legal_entities").select("id,name"),
    db.from("legal_entity_cabinets").select("legal_entity_id,cabinet_id"),
    db.from("product_costs").select("article,cost_rub"),
  ]);
  const relationError = companiesResult.error ?? entitiesResult.error ?? linksResult.error ?? costsResult.error;
  if (relationError) return NextResponse.json({ error: relationError.message }, { status: 502 });

  const companyScopes = buildOpiuCompanyScopes(
    (companiesResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name), groupName: String(row.group_name ?? ""), isActive: Boolean(row.is_active) })),
    (entitiesResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name) })),
    (linksResult.data ?? []).map((row) => ({ legalEntityId: String(row.legal_entity_id), cabinetId: String(row.cabinet_id) })),
  );
  const selectedCompany = requestedCompanyId
    ? companyScopes.find((company) => company.companyIds.includes(requestedCompanyId))
    : null;
  if (requestedCompanyId && !selectedCompany) return NextResponse.json({ error: "Компания не найдена" }, { status: 400 });
  const selectedCabinetIds = selectedCompany ? new Set(selectedCompany.cabinetIds) : null;
  const ownerByCabinetId = new Map(companyScopes.flatMap((company) => company.cabinetIds.map((cabinetId) => [cabinetId, company] as const)));
  const companyNameById = new Map((companiesResult.data ?? []).map((company) => [String(company.id), String(company.name)]));
  const ownerByBrandId = new Map(OPIU_BRANDS.map((brand) => {
    const expectedOwner = wbBrandCompanyName(brand);
    const owner = companyScopes.find((scope) => scope.companyIds.some((companyId) => companyNamesMatch(companyNameById.get(companyId) ?? "", expectedOwner)));
    return [brand.id, owner] as const;
  }));

  const wbCabinetIds = [...new Set(OPIU_BRANDS.map((brand) => brand.cabinetId))];
  const accessPairs = await Promise.all(wbCabinetIds.map(async (cabinetId) => [cabinetId, await hasCabinetAccess(cabinetId)] as const));
  const accessByCabinet = new Map(accessPairs);
  const accessibleBrands = OPIU_BRANDS.filter((brand) => {
    if (!accessByCabinet.get(brand.cabinetId)) return false;
    if (!selectedCompany) return true;
    return ownerByBrandId.get(brand.id)?.id === selectedCompany.id;
  });

  const costByArt = new Map<string, number>();
  for (const row of costsResult.data ?? []) costByArt.set(String(row.article || "").trim().toUpperCase(), num(row.cost_rub));

  const wbSourcesPromise = Promise.all(accessibleBrands.map(async (brand): Promise<MonthlyMarketplaceSource> => {
    const owner = ownerByBrandId.get(brand.id);
    try {
      const wb = monthlyWbActualFromOpiu(await loadOpiuSalePeriod(from, to, [brand.id]));
      return { id: `wb:${brand.id}`, label: wbSourceLabel(brand, owner?.name, !selectedCompany), marketplace: "wb", companyId: owner?.id, wb };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить WB";
      return { id: `wb:${brand.id}`, label: wbSourceLabel(brand, owner?.name, !selectedCompany), marketplace: "wb", companyId: owner?.id, wb: failedWb(message) };
    }
  }));

  const ozonSourcesPromise = (async (): Promise<{ sources: MonthlyMarketplaceSource[]; error: string | null }> => {
    const resolvedOzon = await getOzonCabinetScope("all");
    if (!resolvedOzon.ok) return { sources: [], error: resolvedOzon.error };
    const cabinets = selectedCabinetIds
      ? resolvedOzon.scope.cabinets.filter((cabinet) => selectedCabinetIds.has(cabinet.id))
      : resolvedOzon.scope.cabinets;
    const results = await Promise.all(cabinets.map(async (cabinet) => {
      const owner = ownerByCabinetId.get(cabinet.id);
      const label = selectedCompany
        ? cabinets.length > 1 ? `Ozon ${cabinet.name}` : "Ozon"
        : `Ozon ${owner?.name ?? cabinet.name}`;
      const totals = await ozonTransactionTotals(cabinet.creds, new Date(from).toISOString(), new Date(to).toISOString());
      if (!totals.ok) return { id: cabinet.id, label, ownerId: owner?.id, ozon: failedOzon(totals.error) };
      const [analytics, images] = await Promise.all([ozonAnalytics(cabinet.creds, from, to), ozonImages(cabinet.creds)]);
      let cogs = 0;
      if (analytics.ok) {
        for (const row of analytics.rows) {
          const offer = images.skuToOffer[row.sku];
          cogs += (offer ? costByArt.get(offer.trim().toUpperCase()) ?? 0 : 0) * num(row.ordered_units);
        }
      }
      return {
        id: cabinet.id,
        label,
        ownerId: owner?.id,
        ozon: {
          revenue: r0(num(totals.totals.accruals_for_sale)),
          commission: r0(Math.abs(num(totals.totals.sale_commission))),
          delivery: r0(Math.abs(num(totals.totals.processing_and_delivery))),
          services: r0(Math.abs(num(totals.totals.services_amount))),
          cogs: r0(cogs),
          warnings: analytics.ok ? [] : [analytics.error],
        },
      };
    }));
    return {
      sources: results.map((result) => ({ id: `ozon:${result.id}`, label: result.label, marketplace: "ozon" as const, companyId: result.ownerId, ozon: result.ozon })),
      error: null,
    };
  })();

  const [rawWbSources, ozonResult] = await Promise.all([wbSourcesPromise, ozonSourcesPromise]);
  const wbSources = coalesceWbSources(rawWbSources);
  const ozonSources = ozonResult.sources;
  const sources = [...wbSources, ...ozonSources];
  const wb = wbSources.length ? aggregateWbSources(wbSources) : failedWb("Нет доступа к кабинетам WB из состава ОПиУ");
  const ozon = ozonSources.length
    ? aggregateOzonSources(ozonSources)
    : failedOzon(selectedCompany ? "У компании нет связанного кабинета Ozon" : ozonResult.error ?? "Нет доступных кабинетов Ozon");
  return NextResponse.json({ period: { from, to, month }, wb, ozon, sources });
}
