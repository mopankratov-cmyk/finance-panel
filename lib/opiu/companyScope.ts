import { sameCompanyAlias } from "@/lib/finance/companyAliases";

export interface OpiuCompanyOption {
  id: string;
  name: string;
  groupName: string;
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
