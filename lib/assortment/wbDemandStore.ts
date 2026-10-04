import type { SupabaseClient } from "@supabase/supabase-js";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import type { AssortmentDirection } from "./constants";
import { demandByForm, splitLagging, subjectsFor, type FormDemandReport, type SubjectQueries } from "./wbQueries";
import { readDemandSubjects } from "./wbQueriesStore";
import { demandForTerm, type DemandResult } from "./wbDemand";

export class DemandUnavailableError extends Error {}

/**
 * Срезы раздела на час в кэше Next: списки по 2 000 запросов на предмет читаются
 * из базы ~1 МБ, а вкладка «Формы» и страница каждой модели просят их постоянно.
 * MPSTATS при этом не вызывается вообще — его раз в неделю опрашивает сборщик.
 */
export async function loadDemandSubjects(db: SupabaseClient, direction: AssortmentDirection): Promise<SubjectQueries[]> {
  // Пустой результат (миграцию ещё не применили, сборщик ничего не снял) в кэш не кладём:
  // иначе после первого среза экран ещё час показывал бы «данных нет».
  try {
    return await loadHourlyDashboard("assortment-wb-queries", { direction }, async () => {
      const subjects = await readDemandSubjects(db, direction);
      if (subjects.length === 0) throw new NoSnapshots();
      return subjects;
    });
  } catch (error) {
    if (error instanceof NoSnapshots) return [];
    throw error;
  }
}

class NoSnapshots extends Error {}

/** Спрос по формам для вкладки «Формы»; null — срезов ещё нет. Сбой чтения не роняет вкладку. */
export async function loadFormDemand(db: SupabaseClient, direction: AssortmentDirection): Promise<FormDemandReport | null> {
  try {
    return demandByForm(direction, await loadDemandSubjects(db, direction), subjectsFor(direction).length);
  } catch {
    return null;
  }
}

export const NO_SNAPSHOTS_MESSAGE = "Частотность запросов WB ещё не собрана: сборщик снимает её раз в неделю, первые данные появятся в течение нескольких дней после выкладки и применения миграции 202610050003.";

/** Спрос по слову модели. Берёт готовые срезы из базы, а не MPSTATS: прямой вызов занимает до полутора минут. */
export async function loadWbDemand(
  db: SupabaseClient,
  direction: AssortmentDirection,
  term: string,
): Promise<DemandResult & { period: { from: string; to: string }; subjectsChecked: string[]; previousTo: string | null; queriesChecked: number }> {
  // Предмет, у которого свежий срез не снялся, выглядел бы свежим: берём только актуальные.
  const { fresh: subjects } = splitLagging(await loadDemandSubjects(db, direction));
  if (subjects.length === 0) throw new DemandUnavailableError(NO_SNAPSHOTS_MESSAGE);
  const result = demandForTerm(term, subjects.map((s) => ({ subject: s.subject, current: s.current, previous: s.previous ?? [] })));
  const to = subjects.map((s) => s.windowTo).sort().reverse()[0];
  const from = subjects.find((s) => s.windowTo === to)?.windowFrom ?? to;
  const previousTo = subjects.map((s) => s.previousTo).filter((v): v is string => Boolean(v)).sort().reverse()[0] ?? null;
  return {
    ...result,
    period: { from, to },
    subjectsChecked: subjects.map((s) => s.subject),
    previousTo,
    queriesChecked: Math.max(...subjects.map((s) => s.current.length)),
  };
}
