import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowToday } from "@/lib/sync/moscowDay";
import { isMissingAssortmentSchema, isMissingColumnError } from "./errors";
import { summarizeHistory, type RunRow, type SourceHistory } from "./observationState";

/** За сколько дней читаем журнал прогонов: хватает, чтобы увидеть и «копится», и «динамика» (28 дней). */
const HISTORY_DAYS = 120;
const RUN_COLUMNS = "source_id,direction,observed_on,coverage,seen,added,error,started_at";

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

/**
 * Глубина и полнота истории наблюдений по источникам. С разделом — только прогоны этого раздела и прогоны «целиком» (direction
 * null: Shopify отдаёт куртки и сумки одним обходом): у источника с двумя полными прогонами по курткам и одним по сумкам на
 * экране сумок «появилось/пропало» не наблюдение.
 */
export async function loadHistoryState(db: SupabaseClient, now: Date | number = new Date(), direction?: string): Promise<HistoryState> {
  const today = moscowToday(now);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - HISTORY_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const load = (columns: string) => loadAllSupabasePages<RunRow>((from, to) => db.from("assortment_run")
    .select(columns)
    .gte("observed_on", since)
    .order("started_at", { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: RunRow[] | null; error: { message: string } | null }>, { label: "Журнал прогонов", pageSize: 1000 });
  try {
    let rows: RunRow[];
    try {
      rows = await load(`${RUN_COLUMNS},part`);
    } catch (error) {
      // Миграции 202610060010 (пометка части раздела) ещё нет — читаем без неё: части тогда не отличить, как до неё.
      if (!isMissingColumnError({ message: error instanceof Error ? error.message : String(error) })) throw error;
      rows = await load(RUN_COLUMNS);
    }
    const mine = direction ? rows.filter((r) => r.direction == null || r.direction === direction) : rows;
    return { available: true, today, sources: summarizeHistory(mine, today) };
  } catch (error) {
    if (unavailable(error)) return { available: false, today, sources: [] };
    throw error;
  }
}
