import { normalizeTitle } from "./forms";
import type { KeywordRow } from "./wbDemand";

/**
 * Что сравнивать в «росте» поисков: срезы по предметам и проверка, что это два РАЗНЫХ периода. Общий модуль для «Форм»
 * и страницы модели — чтобы один и тот же срез не давал «роста нет» на одном экране и «+0%» на другом.
 */

export interface DistinctQuery {
  word: string;
  now: number;
  before: number | null;
}

/**
 * Один запрос — одна строка по всем предметам: «бомбер женский» есть и в «Куртках»,
 * и в «Бомберах», но частотность у него одна — складывать её нельзя.
 */
export function distinctQueries(subjects: Array<{ current: KeywordRow[]; previous: KeywordRow[] | null }>): Map<string, DistinctQuery> {
  const out = new Map<string, DistinctQuery>();
  for (const subject of subjects) {
    for (const row of subject.current) {
      const key = normalizeTitle(row.word);
      if (!key) continue;
      const now = Number(row.wb_count) || 0;
      const prev = out.get(key);
      if (!prev) out.set(key, { word: row.word, now, before: null });
      else if (now > prev.now) {
        prev.now = now;
        prev.word = row.word;
      }
    }
  }
  for (const subject of subjects) {
    for (const row of subject.previous ?? []) {
      const entry = out.get(normalizeTitle(row.word));
      if (!entry) continue;
      const before = Number(row.wb_count) || 0;
      entry.before = Math.max(entry.before ?? 0, before);
    }
  }
  return out;
}

/**
 * Можно ли доверять «росту»: none — прошлого среза нет; identical — у почти всех общих запросов частотность та же, что и
 * в прошлом срезе (это не два разных периода: срез сняли повторно или MPSTATS отдал те же числа); ok — срезы различаются.
 */
export type GrowthBase = "ok" | "none" | "identical";
/** Доля общих запросов с той же частотностью, с которой срезы считаются «совпавшими» (порог наш, не свойство данных). */
export const GROWTH_IDENTICAL_SHARE = 0.9;
/** Меньше общих запросов — судить, совпали ли срезы, рано. */
export const GROWTH_IDENTICAL_MIN_QUERIES = 30;

export function growthBaseOf(entries: Iterable<{ now: number; before: number | null }>): GrowthBase {
  let compared = 0;
  let same = 0;
  for (const e of entries) {
    if (e.before == null) continue;
    compared += 1;
    if (e.before === e.now) same += 1;
  }
  if (compared === 0) return "none";
  return compared >= GROWTH_IDENTICAL_MIN_QUERIES && same / compared >= GROWTH_IDENTICAL_SHARE ? "identical" : "ok";
}
