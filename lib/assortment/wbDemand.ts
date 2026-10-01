/**
 * Спрос на WB по модели (улучшение 2 от 01.10.2026). Чистые функции.
 *
 * Берём частотность поисковых запросов из MPSTATS по предметам СВОИХ товаров
 * раздела (сумки CLÉRIN, куртки NORVIA/HEATON) и ищем среди них запросы со
 * словом модели: «хобо», «бомбер». Только частотность и число товаров по
 * запросу — без цен и выручки (граница ТЗ). MPSTATS — оценка: годится для
 * направления, а не для абсолютных чисел.
 */

import type { AssortmentDirection } from "./constants";

export interface KeywordRow {
  word: string;
  wb_count: number;
  items_count?: number;
}

export interface DemandQuery {
  word: string;
  now: number;
  before: number | null;
  items: number | null;
}

export interface SubjectDemand {
  subject: string;
  queries: DemandQuery[];
  total: number;
  totalBefore: number;
  growthPct: number | null;
}

export interface DemandResult {
  term: string;
  subjects: SubjectDemand[];
  total: number;
  growthPct: number | null;
  found: boolean;
}

const norm = (value: string) => value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Слово для поиска: «Запрос на WB» из признаков, иначе силуэт сумки или подтип куртки. */
export function demandTerm(direction: AssortmentDirection, attributes: Record<string, string | null>): string | null {
  const candidates = [attributes.wb_query, direction === "bags" ? attributes.silhouette : attributes.subtype];
  for (const value of candidates) {
    const term = value ? norm(value) : "";
    if (term && term !== "не видно" && term.length >= 3 && term.length <= 60) return term;
  }
  return null;
}

export function growth(now: number, before: number): number | null {
  return before > 0 ? Math.round((now / before - 1) * 100) : null;
}

/** Запросы предмета, где встречается каждое слово термина. */
export function matchDemand(subject: string, term: string, current: KeywordRow[], previous: KeywordRow[]): SubjectDemand {
  const words = norm(term).split(" ").filter(Boolean);
  const hits = (row: KeywordRow) => {
    const text = norm(row.word);
    return words.every((w) => text.includes(w));
  };
  const before = new Map(previous.filter(hits).map((r) => [norm(r.word), r.wb_count]));
  const queries = current.filter(hits)
    .map((r) => ({ word: r.word, now: Number(r.wb_count) || 0, before: before.get(norm(r.word)) ?? null, items: r.items_count != null ? Number(r.items_count) : null }))
    .sort((a, b) => b.now - a.now);
  const total = queries.reduce((s, q) => s + q.now, 0);
  // Рост считаем только по запросам, которые были в обоих периодах: новый
  // запрос в топе не превращается в «+∞%».
  const both = queries.filter((q) => q.before != null);
  const totalBefore = both.reduce((s, q) => s + (q.before ?? 0), 0);
  const totalNowBoth = both.reduce((s, q) => s + q.now, 0);
  return { subject, queries: queries.slice(0, 8), total, totalBefore, growthPct: growth(totalNowBoth, totalBefore) };
}

export function combineDemand(term: string, subjects: SubjectDemand[]): DemandResult {
  const withHits = subjects.filter((s) => s.queries.length > 0).sort((a, b) => b.total - a.total);
  const total = withHits.reduce((s, x) => s + x.total, 0);
  const now = withHits.reduce((s, x) => s + x.queries.filter((q) => q.before != null).reduce((a, q) => a + q.now, 0), 0);
  const before = withHits.reduce((s, x) => s + x.totalBefore, 0);
  return { term, subjects: withHits, total, growthPct: growth(now, before), found: withHits.length > 0 };
}

export const DIRECTION_WB_BRANDS: Record<AssortmentDirection, string[]> = {
  bags: ["clérin", "clerin"],
  jackets: ["norvia", "heaton"],
};

/** Предметы своих карточек: самые частые сначала, по одному товару-образцу на предмет. */
export function ownSubjects(rows: Array<{ subject: string | null; nm_id: number; brand: string | null }>, direction: AssortmentDirection, limit = 3): Array<{ subject: string; nmId: number; count: number }> {
  const brands = DIRECTION_WB_BRANDS[direction];
  const by = new Map<string, { subject: string; nmId: number; count: number }>();
  for (const row of rows) {
    const brand = norm(row.brand ?? "");
    if (!row.subject || !brands.some((b) => brand.includes(b))) continue;
    const entry = by.get(row.subject) ?? { subject: row.subject, nmId: Number(row.nm_id), count: 0 };
    entry.count += 1;
    by.set(row.subject, entry);
  }
  return [...by.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
