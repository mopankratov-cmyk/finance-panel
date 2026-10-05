import type { SupabaseClient } from "@supabase/supabase-js";
import { moscowToday } from "@/lib/sync/moscowDay";
import { catalogAiConfig, estimatedCallUsd, type PhotoTraitsReport } from "./catalogAi";
import { aiKeyConfigured, loadPhotoTraits, loadSpend } from "./catalogAiStore";
import type { AssortmentDirection } from "./constants";
import { buildReadiness, type DemandFacts, type HistoryFacts, type ReadinessInput, type ReadinessReport, type TraitsFacts } from "./dataReadiness";
import { isMissingAssortmentSchema } from "./errors";
import { loadHistoryState } from "./observationStateStore";
import { isRuSource } from "./ruMarket";
import { pickPrevious, splitLagging, subjectsFor } from "./wbQueries";

/**
 * Факты для полоски «На чём стоят цифры». Только чтение базы: ни MPSTATS, ни ИИ при открытии экрана не вызываются
 * (остаток квоты MPSTATS здесь не показываем именно поэтому — он доступен только живым запросом).
 *
 * «Разобрано N из M» берётся из того же отчёта, что блок «Признаки по фото» (loadPhotoTraits, на проде — с часовым кэшем): в
 * числителе только модели из текущего каталога, поэтому скрытые и пропавшие с сайта в счёт не идут, и два числа на одном экране
 * не расходятся. Сбой чтения части не прячется — он становится строкой «не загрузилось».
 */

const RESULTS = "assortment_model_attributes";
const SNAPSHOTS = "assortment_wb_query_snapshot";
/** Как далеко назад читаем срезы спроса: те же 150 дней, что у остальных читателей таблицы (предел выборки PostgREST — 1 000 строк). */
const SNAPSHOT_READ_DAYS = 150;
const RECENT_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

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

/** Отчёт по признакам раздела: загрузчик подставляется (на проде — с часовым кэшем, как у блока «Признаки по фото»). */
export type TraitsLoader = (db: SupabaseClient, direction: AssortmentDirection) => Promise<PhotoTraitsReport | null>;

/** Сколько осталось разобрать в разделе: те же числа, что в блоке «Признаки по фото». */
async function remainingOf(db: SupabaseClient, direction: AssortmentDirection, traits: TraitsLoader): Promise<number | null> {
  try {
    const report = await traits(db, direction);
    return report ? Math.max(0, report.catalog - report.analyzed) : null;
  } catch {
    return null;
  }
}

async function loadTraits(db: SupabaseClient, direction: AssortmentDirection, now: Date, traits: TraitsLoader): Promise<TraitsFacts | null> {
  // Есть ли таблица результатов вообще: нет — блока нет (прячем, а не рисуем нули).
  const failed = await count(db, (q) => q.select("model_key", { count: "exact" }).eq("direction", direction).eq("status", "failed").limit(1));
  if (failed === null) return null;
  const sinceIso = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString();
  const recentFailed = (await count(db, (q) => q.select("model_key", { count: "exact" }).eq("status", "failed").gte("taken_at", sinceIso).limit(1))) ?? 0;
  const recentOk = (await count(db, (q) => q.select("model_key", { count: "exact" }).eq("status", "ok").gte("taken_at", sinceIso).limit(1))) ?? 0;
  const last = await db.from(RESULTS).select("taken_at").eq("status", "ok").order("taken_at", { ascending: false }).limit(1);
  const lastOkAt = last.error ? null : ((last.data ?? []) as Array<{ taken_at: string }>)[0]?.taken_at ?? null;

  const errors = new Map<string, number>();
  if (failed > 0) {
    const { data } = await db.from(RESULTS).select("last_error").eq("direction", direction).eq("status", "failed").order("taken_at", { ascending: false }).limit(300);
    for (const row of (data ?? []) as Array<{ last_error: string | null }>) {
      const message = (row.last_error ?? "").trim();
      if (message) errors.set(message, (errors.get(message) ?? 0) + 1);
    }
  }

  const report = await traits(db, direction);
  let analyzed = report?.analyzed ?? 0;
  let legacy = report?.legacy ?? 0;
  let eligible = report?.catalog ?? 0;
  if (!report) {
    // Ничего ещё не разобрано (или нет вида каталога): знаменатель — счётчики видов по источникам, числитель — нули.
    const stats = await db.from("assortment_catalog_stats").select("source_id,with_photo").eq("direction", direction);
    if (stats.error && !missing(stats.error)) throw new Error(stats.error.message);
    eligible = stats.error ? 0 : ((stats.data ?? []) as Array<{ source_id: string; with_photo: number }>).filter((r) => !isRuSource(r.source_id)).reduce((sum, r) => sum + (Number(r.with_photo) || 0), 0);
    analyzed = 0;
    legacy = 0;
  }

  const other: AssortmentDirection = direction === "jackets" ? "bags" : "jackets";
  const otherRemaining = await remainingOf(db, other, traits);

  const config = catalogAiConfig();
  const spend = await loadSpend(db, now);
  const weekUsd = spend?.weekUsd ?? 0;
  const budgetCallsLeft = config.price && config.weeklyBudgetUsd > 0
    ? Math.floor(Math.max(0, config.weeklyBudgetUsd - weekUsd) / estimatedCallUsd(config.price, config.provider === "polza" ? 1500 : 600))
    : null;
  return {
    enabled: config.enabled,
    keyConfigured: aiKeyConfigured(config.provider),
    priced: Boolean(config.price),
    model: config.model,
    analyzed,
    legacy,
    eligible: Math.max(eligible, analyzed + legacy),
    failed,
    recentOk,
    recentFailed,
    lastOkAt,
    otherRemaining,
    callsToday: spend?.callsToday ?? 0,
    dailyLimit: config.dailyLimit,
    weekUsd,
    weeklyBudgetUsd: config.weeklyBudgetUsd,
    budgetCallsLeft,
    lastErrors: [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([message, n]) => ({ message, count: n })),
  };
}

async function loadDemand(db: SupabaseClient, direction: AssortmentDirection, now: Date): Promise<DemandFacts | null> {
  const since = new Date(Date.parse(`${moscowToday(now)}T00:00:00Z`) - SNAPSHOT_READ_DAYS * DAY_MS).toISOString().slice(0, 10);
  const { data, error } = await db.from(SNAPSHOTS).select("subject_id,window_to").eq("direction", direction).gte("window_to", since);
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<{ subject_id: number; window_to: string }>;
  const total = subjectsFor(direction).length;
  if (rows.length === 0) return { subjectsTotal: total, subjectsFresh: 0, subjectsLagging: 0, withPrevious: 0, latestTo: null };
  // По предмету — его самый свежий срез и «прошлый» к нему; «в расчёте» — как на «Формах»: отставшие больше чем на две недели не считаются.
  const perSubject = subjectsFor(direction).map((subject) => {
    const mine = rows.filter((r) => Number(r.subject_id) === subject.id).map((r) => ({ windowTo: String(r.window_to) }));
    if (mine.length === 0) return null;
    const latest = mine.map((m) => m.windowTo).sort().reverse()[0];
    return { windowTo: latest, hasPrevious: Boolean(pickPrevious(mine, latest)) };
  }).filter((x): x is { windowTo: string; hasPrevious: boolean } => x !== null);
  const { fresh, lagging } = splitLagging(perSubject);
  const latestTo = perSubject.map((s) => s.windowTo).sort().reverse()[0] ?? null;
  return { subjectsTotal: total, subjectsFresh: fresh.length, subjectsLagging: lagging.length, withPrevious: fresh.filter((s) => s.hasPrevious).length, latestTo };
}

async function loadHistory(db: SupabaseClient, direction: AssortmentDirection, now: Date): Promise<HistoryFacts | null> {
  const state = await loadHistoryState(db, now, direction);
  if (!state.available) return null;
  const sources = state.sources.filter((s) => !isRuSource(s.sourceId));
  if (sources.length === 0) return null;
  const { data } = await db.from("assortment_sources").select("source_id,name");
  const nameOf = new Map(((data ?? []) as Array<{ source_id: string; name: string | null }>).map((r) => [String(r.source_id), String(r.name ?? "")]));
  return { sources: sources.map((s) => ({ name: nameOf.get(s.sourceId) || s.sourceId, status: s.status, firstDay: s.firstDay, firstFullDay: s.firstFullDay })) };
}

/**
 * Полоска «На чём стоят цифры» по разделу. Сбой одной части не роняет остальные, но и не прячется: часть попадает в errors,
 * а экран пишет «не загрузилось» — молчание выглядело бы как «данных нет».
 */
export async function loadReadiness(db: SupabaseClient, direction: AssortmentDirection, now: Date = new Date(), deps: { traits?: TraitsLoader } = {}): Promise<ReadinessReport> {
  const traitsLoader: TraitsLoader = deps.traits ?? loadPhotoTraits;
  const errors: string[] = [];
  const guard = async <T>(label: string, run: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      errors.push(`${label}${error instanceof Error && error.message ? ` (${error.message.slice(0, 120)})` : ""}`);
      return null;
    }
  };
  const [traits, demand, history] = await Promise.all([
    guard("признаки по фото", () => loadTraits(db, direction, now, traitsLoader)),
    guard("спрос на WB", () => loadDemand(db, direction, now)),
    guard("история каталогов", () => loadHistory(db, direction, now)),
  ]);
  const input: ReadinessInput = { today: moscowToday(now), nowMs: now.getTime(), traits, demand, history, errors };
  return buildReadiness(input);
}
