import { isLegacySharedExpenseCompany } from "@/lib/finance/companyLabels";
import { isExternalReportingEntity } from "@/lib/finance/groupReportingScope";
import { buildOpiuCompanyScopes, companyNamesMatch } from "@/lib/opiu/companyScope";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CompanyRow = { id: string; name: string; group_name: string | null; is_active: boolean };
type EntityRow = { id: string; name: string; note?: string | null };
type LinkRow = { legal_entity_id: string; cabinet_id: string };

export interface BalanceCompanyScope {
  id: string;
  name: string;
  companyIds: string[];
  legalEntityIds: string[];
  legalEntities: Array<{ id: string; name: string }>;
  cabinetIds: string[];
}

export function buildBalanceCompanyScopes(
  companies: readonly CompanyRow[],
  entities: readonly EntityRow[],
  links: readonly LinkRow[],
): BalanceCompanyScope[] {
  const activeCompanies = companies.filter((company) => company.is_active && !isLegacySharedExpenseCompany(company.name));
  const internalEntities = entities.filter((entity) => !isExternalReportingEntity(entity));
  const opiuScopes = buildOpiuCompanyScopes(
    activeCompanies.map((company) => ({
      id: company.id,
      name: company.name,
      groupName: String(company.group_name ?? ""),
      isActive: company.is_active,
    })),
    internalEntities,
    links.map((link) => ({ legalEntityId: link.legal_entity_id, cabinetId: link.cabinet_id })),
  );

  return opiuScopes.map((scope) => {
    const memberNames = activeCompanies.filter((company) => scope.companyIds.includes(company.id)).map((company) => company.name);
    const legalEntityIds = internalEntities
      .filter((entity) => memberNames.some((name) => companyNamesMatch(name, entity.name)))
      .map((entity) => entity.id);
    return {
      id: scope.id,
      name: scope.name,
      companyIds: scope.companyIds,
      legalEntityIds,
      legalEntities: internalEntities.filter((entity) => legalEntityIds.includes(entity.id)).map(({ id, name }) => ({ id, name })),
      cabinetIds: scope.cabinetIds,
    };
  });
}

export async function loadBalanceCompanyScopes(): Promise<BalanceCompanyScope[]> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const [companies, entities, links] = await Promise.all([
    db.from("companies").select("id,name,group_name,is_active"),
    db.from("legal_entities").select("id,name,note").eq("is_active", true),
    db.from("legal_entity_cabinets").select("legal_entity_id,cabinet_id"),
  ]);
  const error = companies.error ?? entities.error ?? links.error;
  if (error) throw new Error(error.message);
  return buildBalanceCompanyScopes(
    (companies.data ?? []) as CompanyRow[],
    (entities.data ?? []) as EntityRow[],
    (links.data ?? []) as LinkRow[],
  );
}

export function selectBalanceCompanyScope(scopes: readonly BalanceCompanyScope[], companyId: string | null) {
  return companyId ? scopes.find((scope) => scope.id === companyId) ?? null : null;
}
