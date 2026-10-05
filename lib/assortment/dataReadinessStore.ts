import type { SupabaseClient } from "@supabase/supabase-js";
import { moscowToday } from "@/lib/sync/moscowDay";
import { catalogAiConfig, PROMPT_VERSION } from "./catalogAi";
import { aiKeyConfigured, loadSpend } from "./catalogAiStore";
import type { AssortmentDirection } from "./constants";
import { buildReadiness, type DemandFacts, type HistoryFacts, type ReadinessInput, type ReadinessReport, type TraitsFacts } from "./dataReadiness";
import { isMissingAssortmentSchema } from "./errors";
import { loadHistoryState } from "./observationStateStore";
import { isRuSource } from "./ruMarket";
import { pickPrevious, subjectsFor } from "./wbQueries";

/**
 * Факты для полоски «На чём стоят цифры». Только чтение базы: ни MPSTATS, ни ИИ при открытии экрана не вызываются
 * (остаток квоты MPSTATS здесь не показываем именно поэтому — он доступен только живым запросом).
 */

const RESULTS = "assortment_model_attributes";
const SNAPSHOTS = "assortment_wb_query_snapshot";

function missing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || isMissingAssortmentSchema(new Error(error.message ?? ""));
}

async function count(db: SupabaseClient, build: (q: ReturnType<SupabaseClient["from"]>) => unknown): Promise<number | null> {
  const result = (await build(db.from(RESULTS))) as { count: number | null; error: { code?: string; message: string } | null };
  if (result.error) {
    if (missing(result.error)) return null;
    throw new Error(result.error.message);
  }
  return result.count ?? 0;
}

async function loadTraits(db: SupabaseClient, direction: AssortmentDirection, now: Date): Promise<TraitsFacts | null> {
  const analyzed = await count(db, (q) => q.select("model_key", { count: "exact" }).eq("direction", direction).eq("status", "ok").eq("prompt_version", PROMPT_VERSION).limit(1));
  if (analyzed === null) return null;
  const legacy = (await count(db, (q) => q.select("model_key", { count: "exact" }).eq("direction", direction).eq("status", "ok").neq("prompt_version", PROMPT_VERSION).limit(1))) ?? 0;
  const failed = (await count(db, (q) => q.select("model_key", { count: "exact" }).eq("direction", direction).eq("status", "failed").limit(1))) ?? 0;

  const errors = new Map<string, number>();
  if (failed > 0) {
    const { data } = await db.from(RESULTS).select("last_error").eq("direction", direction).eq("status", "failed").order("taken_at", { ascending: false }).limit(300);
    for (const row of (data ?? []) as Array<{ last_error: string | null }>) {
      const message = (row.last_error ?? "").trim();
      if (message) errors.set(message, (errors.get(message) ?? 0) + 1);
    }
  }

  // Знаменатель — модели, которые вообще можно разобрать: с фото и не «Рынок РФ»; счётчики по источникам уже есть в виде.
  const stats = await db.from("assortment_catalog_stats").select("source_id,with_photo").eq("direction", direction);
  const eligible = stats.error ? 0 : ((stats.data ?? []) as Array<{ source_id: string; with_photo: number }>).filter((r) => !isRuSource(r.source_id)).reduce((sum, r) => sum + (Number(r.with_photo) || 0), 0);

  const config = catalogAiConfig();
  const spend = await loadSpend(db, now);
  return {
    enabled: config.enabled,
    keyConfigured: aiKeyConfigured(config.provider),
    analyzed,
    legacy,
    failed,
    eligible: Math.max(eligible, analyzed + legacy),
    callsToday: spend?.callsToday ?? 0,
    dailyLimit: config.dailyLimit,
    weekUsd: spend?.weekUsd ?? 0,
    weeklyBudgetUsd: config.weeklyBudgetUsd,
    lastErrors: [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([message, n]) => ({ message, count: n })),
  };
}

async function loadDemand(db: SupabaseClient, direction: AssortmentDirection): Promise<DemandFacts | null> {
  const { data, error } = await db.from(SNAPSHOTS).select("subject_id,window_to").eq("direction", direction);
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<{ subject_id: number; window_to: string }>;
  if (rows.length === 0) return { subjectsTotal: subjectsFor(direction).length, subjectsWithSnapshot: 0, withPrevious: 0, latestTo: null, firstTo: null };
  const dates = rows.map((r) => String(r.window_to)).sort();
  const latestTo = dates[dates.length - 1];
  let withSnapshot = 0;
  let withPrevious = 0;
  for (const subject of subjectsFor(direction)) {
    const mine = rows.filter((r) => Number(r.subject_id) === subject.id).map((r) => ({ windowTo: String(r.window_to) }));
    if (mine.length === 0) continue;
    withSnapshot += 1;
    const latest = mine.map((m) => m.windowTo).sort().reverse()[0];
    if (pickPrevious(mine, latest)) withPrevious += 1;
  }
  return { subjectsTotal: subjectsFor(direction).length, subjectsWithSnapshot: withSnapshot, withPrevious, latestTo, firstTo: dates[0] };
}

async function loadHistory(db: SupabaseClient, now: Date): Promise<HistoryFacts | null> {
  const state = await loadHistoryState(db, now);
  if (!state.available) return null;
  const sources = state.sources.filter((s) => !isRuSource(s.sourceId));
  if (sources.length === 0) return null;
  const { data } = await db.from("assortment_sources").select("source_id,name");
  const nameOf = new Map(((data ?? []) as Array<{ source_id: string; name: string | null }>).map((r) => [String(r.source_id), String(r.name ?? "")]));
  return { sources: sources.map((s) => ({ name: nameOf.get(s.sourceId) || s.sourceId, status: s.status, firstDay: s.firstDay })) };
}

/** Полоска «На чём стоят цифры» по разделу. Сбой одной части не роняет остальные: она просто не показывается. */
export async function loadReadiness(db: SupabaseClient, direction: AssortmentDirection, now: Date = new Date()): Promise<ReadinessReport> {
  const guard = async <T>(run: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await run();
    } catch {
      return null;
    }
  };
  const [traits, demand, history] = await Promise.all([
    guard(() => loadTraits(db, direction, now)),
    guard(() => loadDemand(db, direction)),
    guard(() => loadHistory(db, now)),
  ]);
  const input: ReadinessInput = { today: moscowToday(now), traits, demand, history };
  return buildReadiness(input);
}
