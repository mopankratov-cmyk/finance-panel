import { isLegacySharedExpenseCompany } from "@/lib/finance/companyLabels";
import { isExternalReportingEntity } from "@/lib/finance/groupReportingScope";
import { buildOpiuCompanyScopes, companyNamesMatch } from "@/lib/opiu/companyScope";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CompanyRow = { id: string; name: string; group_name: string | null; is_active: boolean };
type EntityRow = { id: string; name: string; note?: string | null };
type LinkRow = { legal_entity_id: string; cabinet_id: string; relation?: string | null };
type CabinetRow = { id: string; name: string };

export interface BalanceCompanyScope {
  id: string;
  name: string;
  companyIds: string[];
  legalEntityIds: string[];
  legalEntities: Array<{ id: string; name: string }>;
  cabinetIds: string[];
}

function scopeLabel(entity: EntityRow, cabinetIds: readonly string[], cabinets: readonly CabinetRow[]) {
  const cabinetNames = cabinets.filter((cabinet) => cabinetIds.includes(cabinet.id)).map((cabinet) => cabinet.name);
  const businessName = cabinetNames.find((name) => /retail family|ритейл\s*ф[эе]мили/i.test(name))
    ?? cabinetNames.find((name) => /оптима/i.test(name));
  return businessName ? `${businessName} (${entity.name})` : entity.name;
}

/**
 * Баланс принципиально строже ОПиУ: одно фактическое юрлицо — один баланс.
 * Исторические карточки одного юрлица (Филиппов/Коровкин) можно объединить,
 * но агентский кабинет не становится активом агента. В баланс попадают
 * только связи relation=own.
 */
export function buildBalanceCompanyScopes(
  companies: readonly CompanyRow[],
  entities: readonly EntityRow[],
  links: readonly LinkRow[],
  cabinets: readonly CabinetRow[] = [],
): BalanceCompanyScope[] {
  const activeCompanies = companies.filter((company) => company.is_active && !isLegacySharedExpenseCompany(company.name));
  const internalEntities = entities.filter((entity) => !isExternalReportingEntity(entity));
  const ownLinks = links.filter((link) => !link.relation || link.relation === "own");
  const opiuScopes = buildOpiuCompanyScopes(
    activeCompanies.map((company) => ({
      id: company.id,
      name: company.name,
      groupName: String(company.group_name ?? ""),
      isActive: company.is_active,
    })),
    internalEntities,
    ownLinks.map((link) => ({ legalEntityId: link.legal_entity_id, cabinetId: link.cabinet_id })),
  );

  return opiuScopes.map((scope) => {
    const memberNames = activeCompanies.filter((company) => scope.companyIds.includes(company.id)).map((company) => company.name);
    const matchedEntities = internalEntities.filter((entity) => memberNames.some((name) => companyNamesMatch(name, entity.name)));
    const labelEntity = matchedEntities.find((entity) => ownLinks.some((link) => link.legal_entity_id === entity.id && scope.cabinetIds.includes(link.cabinet_id)))
      ?? matchedEntities[0]
      ?? { id: "", name: scope.name };
    return {
      id: scope.id,
      name: scopeLabel(labelEntity, scope.cabinetIds, cabinets),
      companyIds: scope.companyIds,
      legalEntityIds: matchedEntities.map((entity) => entity.id),
      legalEntities: matchedEntities.map(({ id, name }) => ({ id, name })),
      cabinetIds: scope.cabinetIds,
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

export async function loadBalanceCompanyScopes(): Promise<BalanceCompanyScope[]> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const [companies, entities, links, cabinets] = await Promise.all([
    db.from("companies").select("id,name,group_name,is_active"),
    db.from("legal_entities").select("id,name,note").eq("is_active", true),
    db.from("legal_entity_cabinets").select("legal_entity_id,cabinet_id,relation"),
    db.from("wb_cabinets").select("id,name").eq("is_active", true),
  ]);
  const error = companies.error ?? entities.error ?? links.error ?? cabinets.error;
  if (error) throw new Error(error.message);
  return buildBalanceCompanyScopes(
    (companies.data ?? []) as CompanyRow[],
    (entities.data ?? []) as EntityRow[],
    (links.data ?? []) as LinkRow[],
    (cabinets.data ?? []) as CabinetRow[],
  );
}

export function selectBalanceCompanyScope(scopes: readonly BalanceCompanyScope[], companyId: string | null) {
  return companyId ? scopes.find((scope) => scope.id === companyId) ?? null : null;
}
