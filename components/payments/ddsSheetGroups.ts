import type { DdsCompany } from "./ddsCompanies";
import { companyAliasKeys } from "@/lib/finance/companyAliases";

const MAIN_GROUP_COMPANIES = [
  "ип кучеренко",
  "ип панкратов",
  "ооо рио",
  "ооо иллюмей",
  "ооо глобалкос",
  "прайм бьюти",
];

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/g, " ").trim();

function safeSheetPart(value: string) {
  return value.replace(/[\\/?*:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 25) || "Без названия";
}

export function ddsSheetNameForCompany(company: DdsCompany | null | undefined): string {
  if (!company) return "ДДС На проверке";
  const name = normalize(company.name);
  if (companyAliasKeys(name).length) return "ДДС Коровкин-Филиппов";
  if (MAIN_GROUP_COMPANIES.some((known) => name.includes(known))) return "ДДС Группа компаний";
  return `ДДС ${safeSheetPart(company.name)}`.slice(0, 31);
}

export function groupCompanyIdsByDdsSheet(companies: DdsCompany[]) {
  const result = new Map<string, Set<string>>();
  for (const company of companies) {
    const sheet = ddsSheetNameForCompany(company);
    const ids = result.get(sheet) ?? new Set<string>();
    ids.add(company.id);
    result.set(sheet, ids);
  }
  return result;
}
