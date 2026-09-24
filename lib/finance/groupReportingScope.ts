import { isLegacySharedExpenseCompany } from "@/lib/finance/companyLabels";
import { companyNamesMatch } from "@/lib/opiu/companyScope";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CompanyRow = { name: string; is_active: boolean };
type EntityRow = { id: string; name: string };
type LinkRow = { legal_entity_id: string; cabinet_id: string };

export interface GroupReportingScope {
  legalEntityIds: Set<string>;
  cabinetIds: Set<string>;
}

/**
 * Финансовая отчётность группы строится только по активным компаниям из
 * справочника финансовой панели. Юрлица внешних селлеров могут существовать
 * для изоляции склада и прав, но без соответствующей компании в ОПиУ они не
 * являются частью группы и не должны попадать в Баланс.
 */
export function buildGroupReportingScope(
  companies: readonly CompanyRow[],
  entities: readonly EntityRow[],
  links: readonly LinkRow[],
): GroupReportingScope {
  const companyNames = companies
    .filter((company) => company.is_active && !isLegacySharedExpenseCompany(company.name))
    .map((company) => company.name);
  const legalEntityIds = new Set(
    entities
      .filter((entity) => companyNames.some((companyName) => companyNamesMatch(companyName, entity.name)))
      .map((entity) => entity.id),
  );
  const cabinetIds = new Set(
    links
      .filter((link) => legalEntityIds.has(link.legal_entity_id))
      .map((link) => link.cabinet_id),
  );
  return { legalEntityIds, cabinetIds };
}

export async function loadGroupReportingScope(): Promise<GroupReportingScope> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const [companies, entities, links] = await Promise.all([
    db.from("companies").select("name,is_active"),
    db.from("legal_entities").select("id,name").eq("is_active", true),
    db.from("legal_entity_cabinets").select("legal_entity_id,cabinet_id"),
  ]);
  const error = companies.error ?? entities.error ?? links.error;
  if (error) throw new Error(error.message);
  return buildGroupReportingScope(
    (companies.data ?? []) as CompanyRow[],
    (entities.data ?? []) as EntityRow[],
    (links.data ?? []) as LinkRow[],
  );
}
