import { companyAliasGroup } from "@/lib/finance/companyAliases";

function normalizedCounterpartyKey(name: string) {
  const legalSoleProprietor = /(?:^|[\s(])ип(?:[\s)]|$)|индивидуальн(?:ый|ого)\s+предпринимател(?:ь|я)/i.test(name);
  const aliasGroup = legalSoleProprietor ? companyAliasGroup(name) : null;
  if (aliasGroup) return `company-alias:${aliasGroup.join("|")}`;
  const normalized = name
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/индивидуальн(?:ый|ого)\s+предпринимател(?:ь|я)/g, "ип")
    .replace(/обществ(?:о|а)\s+с\s+ограниченной\s+ответственностью/g, "ооо")
    .replace(/[«»"'(),.\-–—/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const inn = normalized.match(/инн\s*:?\s*(\d{10}|\d{12})/)?.[1];
  return inn ? `inn:${inn}` : normalized.replace(/\s/g, "");
}

/**
 * Банки пишут одно юрлицо по-разному: с ИНН вплотную к названию, полным или
 * сокращённым ОПФ и разным регистром. В списке оставляем один вариант, но
 * текущее сохранённое значение не переписываем без действия пользователя.
 */
export function uniqueCounterpartyOptions(options: readonly string[], current = "") {
  const names = [current, ...options].map((name) => name.trim()).filter(Boolean);
  const byIdentity = new Map<string, string>();
  for (const name of names) {
    const key = normalizedCounterpartyKey(name);
    if (!byIdentity.has(key)) byIdentity.set(key, name);
  }
  return [...byIdentity.values()].sort((a, b) => a.localeCompare(b, "ru"));
}
