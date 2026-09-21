import { companyAliasGroup, sameCompanyAlias } from "@/lib/finance/companyAliases";
import { companyGroupLabel, isLegacySharedExpenseCompany } from "@/lib/finance/companyLabels";
import type { CompanyTaxSystem, CompanyVatMode } from "@/lib/finance/companyTax";

export interface OpiuCompanyOption {
  id: string;
  name: string;
  groupName: string;
  taxSystem?: CompanyTaxSystem | null;
  vatMode?: CompanyVatMode | null;
  taxRate?: number | null;
  taxAdditionalRate?: number | null;
}

export interface OpiuCompanyScope extends OpiuCompanyOption {
  companyIds: string[];
  cabinetIds: string[];
}

interface CompanyRow extends OpiuCompanyOption {
  isActive?: boolean;
}

interface LegalEntityRow {
  id: string;
  name: string;
}

interface LegalEntityCabinetRow {
  legalEntityId: string;
  cabinetId: string;
}

const normalizeCompanyName = (value: string) => value
  .toLowerCase()
  .replace(/ё/g, "е")
  .replace(/[«»"']/g, "")
  .replace(/[^а-яa-z0-9]+/g, " ")
  .replace(/^(ип|ооо|ао)\s+/, "")
  .trim();

export function companyNamesMatch(left: string, right: string): boolean {
  return normalizeCompanyName(left) === normalizeCompanyName(right) || sameCompanyAlias(left, right);
}

export function marketplaceCabinetIdsForCompany(
  companyName: string,
  legalEntities: readonly LegalEntityRow[],
  links: readonly LegalEntityCabinetRow[],
): Set<string> {
  const entityIds = new Set(
    legalEntities
      .filter((entity) => companyNamesMatch(companyName, entity.name))
      .map((entity) => entity.id),
  );
  return new Set(links.filter((link) => entityIds.has(link.legalEntityId)).map((link) => link.cabinetId));
}

/**
 * ОПиУ показывает одно юрлицо один раз. Исторические карточки
 * «ИП Коровкин» и «ИП Филиппов» объединяются, но их id сохраняются для
 * фильтрации ДДС и зарплаты без потери старых операций.
 */
export function buildOpiuCompanyScopes(
  companies: readonly CompanyRow[],
  legalEntities: readonly LegalEntityRow[] = [],
  links: readonly LegalEntityCabinetRow[] = [],
): OpiuCompanyScope[] {
  const active = companies.filter((company) => company.isActive !== false && !isLegacySharedExpenseCompany(company.name));
  const grouped = new Map<string, CompanyRow[]>();
  for (const company of active) {
    const alias = companyAliasGroup(company.name);
    const key = alias ? `alias:${alias.join("|")}` : `company:${company.id}`;
    const members = grouped.get(key) ?? [];
    members.push(company);
    grouped.set(key, members);
  }
  return [...grouped.values()]
    .map((members) => {
      const canonical = members.find((company) => /коровкин/i.test(company.name)) ?? members[0]!;
      const taxOwner = members.find((company) => company.taxSystem != null || company.vatMode != null || company.taxRate != null || company.taxAdditionalRate != null) ?? canonical;
      const cabinetIds = new Set<string>();
      for (const member of members) {
        for (const id of marketplaceCabinetIdsForCompany(member.name, legalEntities, links)) cabinetIds.add(id);
      }
      return {
        id: canonical.id,
        name: canonical.name,
        groupName: companyGroupLabel(canonical.groupName),
        ...(taxOwner.taxSystem !== undefined ? { taxSystem: taxOwner.taxSystem } : {}),
        ...(taxOwner.vatMode !== undefined ? { vatMode: taxOwner.vatMode } : {}),
        ...(taxOwner.taxRate !== undefined ? { taxRate: taxOwner.taxRate } : {}),
        ...(taxOwner.taxAdditionalRate !== undefined ? { taxAdditionalRate: taxOwner.taxAdditionalRate } : {}),
        companyIds: members.map((company) => company.id),
        cabinetIds: [...cabinetIds],
      };
    })
    .sort((left, right) => left.groupName.localeCompare(right.groupName, "ru") || left.name.localeCompare(right.name, "ru"));
}
