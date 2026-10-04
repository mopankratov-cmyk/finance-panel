import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowToday } from "@/lib/sync/moscowDay";
import { isMissingAssortmentSchema } from "./errors";
import { summarizeHistory, type RunRow, type SourceHistory } from "./observationState";

/** За сколько дней читаем журнал прогонов: хватает, чтобы увидеть и «копится», и «динамика» (28 дней). */
const HISTORY_DAYS = 120;

export interface HistoryState {
  /** false — журнала ещё нет (миграция 202610050001 не применена). */
  available: boolean;
  today: string;
  sources: SourceHistory[];
}

function unavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "");
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205" || isMissingAssortmentSchema(new Error(message));
}

/** Глубина и полнота истории наблюдений по источникам. */
export async function loadHistoryState(db: SupabaseClient, now: Date | number = new Date()): Promise<HistoryState> {
  const today = moscowToday(now);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - HISTORY_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    const rows = await loadAllSupabasePages<RunRow>((from, to) => db.from("assortment_run")
      .select("source_id,direction,observed_on,coverage,seen,added,error,started_at")
      .gte("observed_on", since)
      .order("started_at", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: RunRow[] | null; error: { message: string } | null }>, { label: "Журнал прогонов", pageSize: 1000 });
    return { available: true, today, sources: summarizeHistory(rows, today) };
  } catch (error) {
    if (unavailable(error)) return { available: false, today, sources: [] };
    throw error;
  }
}
