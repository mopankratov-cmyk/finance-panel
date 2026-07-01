export const GENERIC_OPENER_PATTERNS = [
  "привет",
  "друзья",
  "сегодня расскажу",
  "сегодня покажу",
  "хочу показать",
  "давайте разбер",
  "давайте разберемся",
  "давайте разберёмся",
  "в современном мире",
  "это не просто",
  "идеальное решение",
  "лучший товар",
  "отличный товар",
  "представляем",
  "в наличии",
  "успей купить",
  "успей",
  "купите",
  "беги покупать",
  "рекомендую",
  "советую",
] as const;

export function hasGenericOpener(text: string): boolean {
  const lower = String(text || "").toLowerCase();
  return GENERIC_OPENER_PATTERNS.some((pattern) => lower.includes(pattern));
}

export function countGenericOpeners(text: string): number {
  const lower = String(text || "").toLowerCase();
  return GENERIC_OPENER_PATTERNS.filter((pattern) => lower.includes(pattern)).length;
}
