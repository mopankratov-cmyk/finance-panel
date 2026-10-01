import type { SupabaseClient } from "@supabase/supabase-js";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { hasMpstats, itemSubject, subjectKeywordsId } from "@/lib/mpstats/client";
import { closedMoscowDates } from "@/lib/wb/sklejki";
import type { AssortmentDirection } from "./constants";
import { combineDemand, matchDemand, ownSubjects, type DemandResult, type KeywordRow } from "./wbDemand";

export class DemandUnavailableError extends Error {}

interface SubjectKeywords {
  subject: string;
  current: KeywordRow[];
  previous: KeywordRow[];
}

/**
 * Частотность запросов предметов своих товаров раздела за 30 дней и 30 дней
 * до них. Списки запросов кэшируются на час и одни на все модели раздела —
 * квоту MPSTATS тратим на раздел, а не на каждую карточку.
 */
async function subjectKeywords(db: SupabaseClient, direction: AssortmentDirection): Promise<{ period: { from: string; to: string }; subjects: SubjectKeywords[] }> {
  const dates = closedMoscowDates(60);
  const previous = { from: dates[0], to: dates[29] };
  const current = { from: dates[30], to: dates[59] };
  return loadHourlyDashboard("assortment-wb-demand", { direction, to: current.to }, async () => {
    const { data, error } = await db.from("wb_cards").select("nm_id,brand,subject").not("subject", "is", null).limit(5000);
    if (error) throw new Error(error.message);
    const subjects = ownSubjects((data ?? []) as Array<{ subject: string | null; nm_id: number; brand: string | null }>, direction);
    const out: SubjectKeywords[] = [];
    for (const s of subjects) {
      const resolved = await itemSubject(s.nmId);
      if (!resolved) continue;
      const [now, before] = await Promise.all([
        subjectKeywordsId(resolved.id, current.from, current.to, 400),
        subjectKeywordsId(resolved.id, previous.from, previous.to, 400),
      ]);
      out.push({ subject: resolved.name || s.subject, current: now, previous: before });
    }
    return { period: current, subjects: out };
  });
}

export async function loadWbDemand(db: SupabaseClient, direction: AssortmentDirection, term: string): Promise<DemandResult & { period: { from: string; to: string }; subjectsChecked: string[] }> {
  if (!hasMpstats()) throw new DemandUnavailableError("MPSTATS не подключён в окружении панели.");
  const { period, subjects } = await subjectKeywords(db, direction);
  if (subjects.length === 0) throw new DemandUnavailableError("Своих карточек раздела на WB не нашлось — не по чему определить предмет.");
  const result = combineDemand(term, subjects.map((s) => matchDemand(s.subject, term, s.current, s.previous)));
  return { ...result, period, subjectsChecked: subjects.map((s) => s.subject) };
}
