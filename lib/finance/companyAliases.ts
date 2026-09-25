// Справочник алиасов юрлиц: разные названия, которые в панели считаются одной
// компанией. Раньше «ИП Филиппов = ИП Коровкин» было зашито в семи местах
// (классификатор выписки, разбор ответов, промпты трёх ИИ-вызовов, листы
// Google, подсказка компании по договору). Новая пара — одна строка здесь.

const ALIAS_GROUPS: ReadonlyArray<readonly string[]> = [
  ["филиппов", "коровкин"],
];
const CANONICAL_ALIAS_KEYS = ["коровкин"] as const;

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]+/g, " ").trim();

/** Группа алиасов, в которую попадает текст (по вхождению любого ключа), или null. */
export function companyAliasGroup(text: string): readonly string[] | null {
  const value = normalize(text);
  return ALIAS_GROUPS.find((group) => group.some((key) => value.includes(key))) ?? null;
}

/** Ключи-алиасы, которыми можно искать компанию для этого текста (включая исходный). */
export function companyAliasKeys(text: string): readonly string[] {
  return companyAliasGroup(text) ?? [];
}

/** Оба текста относятся к одной группе алиасов. */
export function sameCompanyAlias(left: string, right: string): boolean {
  const group = companyAliasGroup(left);
  return Boolean(group) && group === companyAliasGroup(right);
}

/** Выбирает одну каноническую компанию для владельца/получателя с алиасами. */
export function preferredAliasCompany<T extends { name: string }>(text: string, companies: readonly T[]): T | null {
  const group = companyAliasGroup(text);
  if (!group) return null;
  const matching = companies.filter((company) => group.some((key) => normalize(company.name).includes(key)));
  if (!matching.length) return null;
  const canonicalKey = CANONICAL_ALIAS_KEYS[ALIAS_GROUPS.indexOf(group)] ?? group[0];
  return matching.find((company) => normalize(company.name).includes(canonicalKey)) ?? matching[0];
}

/** Строка для промптов ИИ — чтобы модель знала об алиасах, не выдумывая их. */
export const COMPANY_ALIAS_PROMPT_NOTE = ALIAS_GROUPS
  .map((group) => group.map((key) => `ИП ${key[0].toUpperCase()}${key.slice(1)}`).join(" и ") + " — одно юридическое лицо")
  .join(". ");
