import type { SupabaseClient } from "@supabase/supabase-js";
import { moscowToday } from "@/lib/sync/moscowDay";
import { partLabel } from "./brightdataCatalog";
import { catalogAiConfig, CATALOG_AI_JOB, estimatedCallUsd, parseStopTag, type PhotoTraitsReport } from "./catalogAi";
import { aiKeyConfigured, loadPhotoTraits, loadQueueDirect, loadSpend, type QueueFacts } from "./catalogAiStore";
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

/** Очередь раздела без готового отчёта: подставляется (на проде — с часовым кэшем). */
export type QueueLoader = (db: SupabaseClient, direction: AssortmentDirection) => Promise<QueueFacts>;

/**
 * Очередь сборщика по разделу: из отчёта (он считает её тем же правилом, что сам сборщик), а когда отчёта нет или он пришёл без
 * очереди — прямым чтением каталога и результатов. «Не взял бы никогда» (три неудачные попытки, нестабильный ключ) в очередь не входит.
 */
async function queueOf(db: SupabaseClient, direction: AssortmentDirection, report: PhotoTraitsReport | null, queue: QueueLoader): Promise<QueueFacts> {
  if (report?.queue) return { eligible: report.catalog, queue: report.queue };
  return queue(db, direction);
}

async function loadTraits(db: SupabaseClient, direction: AssortmentDirection, now: Date, traits: TraitsLoader, queue: QueueLoader, note: (message: string) => void): Promise<TraitsFacts | null> {
  // Есть ли таблица результатов вообще: нет — блока нет (прячем, а не рисуем нули).
  const failed = await count(db, (q) => q.select("model_key", { count: "exact" }).eq("direction", direction).eq("status", "failed").limit(1));
  if (failed === null) return null;
  const sinceIso = new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString();
  // Удача — разобрано без ошибки (last_error пуст). Неудачный ПЕРЕСБОР старой строки статус «ok» сохраняет и только пишет last_error
  // с новой taken_at: считать его удачей значило бы занижать долю неудач и показывать время неудачной попытки как «последняя модель разобрана».
  // Доля неудач — по ЭТОМУ разделу: чужие сбои (у сумок не качаются фото брендов) в разделе, где их нет, красной тревоги не дают.
  // Жив ли сборщик вообще (последняя попытка, последняя удача), судим по всей таблице: он общий.
  const recentOk = (await count(db, (q) => q.select("model_key", { count: "exact" }).eq("direction", direction).eq("status", "ok").is("last_error", null).gte("taken_at", sinceIso).limit(1))) ?? 0;
  const recentFailedNew = (await count(db, (q) => q.select("model_key", { count: "exact" }).eq("direction", direction).eq("status", "failed").gte("taken_at", sinceIso).limit(1))) ?? 0;
  const recentFailedRebuild = (await count(db, (q) => q.select("model_key", { count: "exact" }).eq("direction", direction).eq("status", "ok").not("last_error", "is", null).gte("taken_at", sinceIso).limit(1))) ?? 0;
  // Сбой этих двух чтений не молчит (строка в errors) и не превращается в «ни одной удачи»: время неизвестно — null и без тревоги.
  const last = await db.from(RESULTS).select("taken_at").eq("status", "ok").is("last_error", null).order("taken_at", { ascending: false }).limit(1);
  if (last.error) note(`время последней разобранной модели (${last.error.message.slice(0, 120)})`);
  const lastOkAt = last.error ? null : ((last.data ?? []) as Array<{ taken_at: string }>)[0]?.taken_at ?? null;
  // Последняя попытка любого рода — удачная, неудачная, неудачный пересбор: по ней судим, работает ли сборщик (свежая неудача — тоже
  // доказательство, что он жив; доля неудач ловится отдельно).
  const attempt = await db.from(RESULTS).select("taken_at").order("taken_at", { ascending: false }).limit(1);
  if (attempt.error) note(`время последней попытки разбора (${attempt.error.message.slice(0, 120)})`);
  const lastAttemptAt = attempt.error ? null : ((attempt.data ?? []) as Array<{ taken_at: string }>)[0]?.taken_at ?? null;

  const errors = new Map<string, number>();
  if (failed > 0) {
    const { data } = await db.from(RESULTS).select("last_error").eq("direction", direction).eq("status", "failed").order("taken_at", { ascending: false }).limit(300);
    for (const row of (data ?? []) as Array<{ last_error: string | null }>) {
      const message = (row.last_error ?? "").trim();
      if (message) errors.set(message, (errors.get(message) ?? 0) + 1);
    }
  }

  const report = await traits(db, direction);
  const own = await queueOf(db, direction, report, queue);
  const analyzed = report?.analyzed ?? 0;
  const legacy = report?.legacy ?? 0;

  // Очередь у сборщика общая: остаток другого раздела входит в срок. Не прочитался — null и строка в errors, а не тихий ноль:
  // «очередь разобрана» при нечитаемой второй половине было бы ложью.
  const other: AssortmentDirection = direction === "jackets" ? "bags" : "jackets";
  let otherQueued: number | null = null;
  try {
    const otherReport = await traits(db, other).catch(() => null);
    const otherFacts = await queueOf(db, other, otherReport, queue);
    if (otherFacts.catalogMissing) note("очередь другого раздела (нет вида каталога — миграция 202610050002)");
    else otherQueued = otherFacts.queue.queued;
  } catch (error) {
    note(`очередь другого раздела${error instanceof Error && error.message ? ` (${error.message.slice(0, 120)})` : ""}`);
  }

  // Имена источников для строки «вне разбора»: не прочитались — называем источники кодами, а не прячем строку.
  let nameOf = new Map<string, string>();
  if ((own.queue.outside ?? []).length > 0) {
    const { data: names, error: namesError } = await db.from("assortment_sources").select("source_id,name");
    if (!namesError) nameOf = new Map(((names ?? []) as Array<{ source_id: string; name: string | null }>).map((n) => [String(n.source_id), String(n.name ?? "")]));
  }
  const outside = own.queue.outside?.map((o) => ({ ...o, name: nameOf.get(o.sourceId) || o.sourceId }));

  // Последний прогон крона разбора по журналу: причина остановки (ключ не принят, нет денег, лимит…) видна только там. Сбой чтения —
  // строка в errors и «не знаем» (undefined), а не «ещё не запускался».
  let lastRun: TraitsFacts["lastRun"];
  const log = await db.from("sync_log").select("status,error,started_at").eq("job", CATALOG_AI_JOB).order("started_at", { ascending: false }).limit(1);
  if (log.error) {
    if (!missing(log.error)) note(`журнал прогонов разбора (${log.error.message.slice(0, 120)})`);
  } else {
    const row = ((log.data ?? []) as Array<{ status: "ok" | "partial" | "error"; error: string | null; started_at: string }>)[0];
    lastRun = row ? { at: row.started_at, status: row.status, ...parseStopTag(row.error) } : null;
  }

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
    eligible: Math.max(own.eligible, analyzed + legacy),
    catalogMissing: Boolean(own.catalogMissing),
    queued: own.queue.queued,
    exhausted: own.queue.exhausted,
    unstable: own.queue.unstable,
    failed,
    recentOk,
    recentFailed: recentFailedNew + recentFailedRebuild,
    lastOkAt,
    lastAttemptAt,
    readFailed: Boolean(last.error || attempt.error),
    otherQueued,
    callsToday: spend?.callsToday ?? 0,
    dailyLimit: config.dailyLimit,
    weekUsd,
    weeklyBudgetUsd: config.weeklyBudgetUsd,
    budgetCallsLeft,
    lastErrors: [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([message, n]) => ({ message, count: n })),
    ...(outside ? { outside } : {}),
    ...(lastRun !== undefined ? { lastRun } : {}),
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
  const { data } = await db.from("assortment_sources").select("source_id,name,categories");
  const rows = (data ?? []) as Array<{ source_id: string; name: string | null; categories: string[] | null }>;
  const nameOf = new Map(rows.map((r) => [String(r.source_id), String(r.name ?? "")]));
  // Прогон Shopify-источника пишется без раздела (обход целиком), поэтому история «Курток» включала бы источники, у которых
  // куртки не собираются вообще: источник берём, только если раздел — в его категориях (категорий нет — не отбрасываем).
  const inSection = new Map(rows.map((r) => [String(r.source_id), !Array.isArray(r.categories) || r.categories.length === 0 || r.categories.includes(direction)]));
  const mine = sources.filter((s) => inSection.get(s.sourceId) !== false);
  if (mine.length === 0) return null;
  return { sources: mine.map((s) => ({
    name: nameOf.get(s.sourceId) || s.sourceId, status: s.status, firstDay: s.firstDay, firstFullDay: s.firstFullDay,
    ...(s.partNames.length ? { parts: s.partNames.map(partLabel) } : {}),
  })) };
}

/**
 * Полоска «На чём стоят цифры» по разделу. Сбой одной части не роняет остальные, но и не прячется: часть попадает в errors,
 * а экран пишет «не загрузилось» — молчание выглядело бы как «данных нет».
 */
export async function loadReadiness(db: SupabaseClient, direction: AssortmentDirection, now: Date = new Date(), deps: { traits?: TraitsLoader; queue?: QueueLoader } = {}): Promise<ReadinessReport> {
  const traitsLoader: TraitsLoader = deps.traits ?? loadPhotoTraits;
  const queueLoader: QueueLoader = deps.queue ?? ((client, direction_) => loadQueueDirect(client, direction_, now.getTime()));
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
    guard("признаки по фото", () => loadTraits(db, direction, now, traitsLoader, queueLoader, (message) => errors.push(message))),
    guard("спрос на WB", () => loadDemand(db, direction, now)),
    guard("история каталогов", () => loadHistory(db, direction, now)),
  ]);
  const input: ReadinessInput = { today: moscowToday(now), nowMs: now.getTime(), traits, demand, history, errors };
  return buildReadiness(input);
}
