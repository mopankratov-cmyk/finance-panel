import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowToday } from "@/lib/sync/moscowDay";
import { aiPrompt } from "./aiAttributes";
import { CATALOG_SEEN_DAYS } from "./catalog";
import {
  allowance, buildPhotoTraits, catalogAiConfig, CATALOG_AI_KIND, costUsd, parseCatalogAnswer, pickCandidates, PROMPT_VERSION, resultKey,
  type CatalogAiConfig, type CatalogHead, type ExistingResult, type PhotoTraitsReport, type StoredAttributes, type TraitModel,
} from "./catalogAi";
import type { AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema, isMissingColumnError } from "./errors";
import { modelKey } from "./modelKey";
import { isRuSource } from "./ruMarket";

/**
 * Разбор каталога по фото и отчёт по признакам. Без миграции 202610050005 (таблица
 * признаков и учёт расхода) сборщик молча пропускает прогон, отчёт отдаёт «данных нет».
 */

const RESULTS = "assortment_model_attributes";
const USAGE = "assortment_ai_usage";
const HEADS_VIEW = "assortment_catalog_heads";
const MAX_IMAGES = 2;
/** Сколько пачек подряд без успеха — это уже не «плохие фото», а сбой. */
const DEAD_BATCHES_STOP = 4;
/** Сколько моделей источника подряд без единого успеха в прогоне — и источник в этом прогоне пропускаем (фото не скачиваются). */
const SOURCE_DEAD_FAILS = 6;

export class CatalogAiTableMissingError extends Error {}

function missing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || isMissingAssortmentSchema(new Error(error.message ?? "")) || isMissingColumnError(error);
}

interface HeadRow {
  source_id: string;
  source_item_id: string;
  model_key: string | null;
  direction: AssortmentDirection;
  title: string | null;
  image_urls: string[] | null;
  model_first_seen_at: string | null;
}

/** Модели текущего каталога (по одной голове на модель) с фото. null — вида каталога ещё нет. */
export async function loadCatalogHeads(db: SupabaseClient, direction: AssortmentDirection | null, nowMs = Date.now()): Promise<CatalogHead[] | null> {
  const seenSince = new Date(nowMs - CATALOG_SEEN_DAYS * 24 * 3600 * 1000).toISOString();
  try {
    const rows = await loadAllSupabasePages<HeadRow>((from, to) => {
      let q = db.from(HEADS_VIEW)
        .select("source_id,source_item_id,model_key,direction,title,image_urls,model_first_seen_at")
        .gte("model_last_seen_at", seenSince)
        .is("model_hidden_at", null);
      if (direction) q = q.eq("direction", direction);
      return q.order("source_id", { ascending: true }).order("source_item_id", { ascending: true }).range(from, to) as unknown as PromiseLike<{ data: HeadRow[] | null; error: { message: string } | null }>;
    }, { label: "Каталог для признаков по фото", pageSize: 1000 });
    return rows.map((r) => {
      const computed = modelKey({ sourceId: r.source_id, sourceItemId: r.source_item_id, title: r.title });
      return {
      // Ключ в базе не совпал с тем, что считает код (SQL-заполнение до обхода, H&M) — ближайший обход его перепишет.
      keyStable: r.model_key == null || r.model_key === computed,
      sourceId: r.source_id,
      sourceItemId: r.source_item_id,
      modelKey: r.model_key ?? computed,
      direction: r.direction,
      title: r.title ?? "",
      imageUrls: (r.image_urls ?? []).filter((u) => typeof u === "string" && /^https:\/\//.test(u)),
      firstSeenAt: r.model_first_seen_at ?? "",
    };
    });
  } catch (error) {
    if (missing({ message: error instanceof Error ? error.message : "" })) return null;
    throw error;
  }
}

/** Что уже разобрано (ключ — источник и модель). null — таблицы признаков ещё нет. */
export async function loadExisting(db: SupabaseClient): Promise<Map<string, ExistingResult> | null> {
  try {
    const rows = await loadAllSupabasePages<{ source_id: string; model_key: string; status: "ok" | "failed"; attempts: number; prompt_version: string; taken_at: string }>((from, to) => db.from(RESULTS)
      .select("source_id,model_key,status,attempts,prompt_version,taken_at")
      .order("source_id", { ascending: true })
      .order("model_key", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Array<{ source_id: string; model_key: string; status: "ok" | "failed"; attempts: number; prompt_version: string; taken_at: string }> | null; error: { message: string } | null }>, { label: "Признаки каталога", pageSize: 1000 });
    return new Map(rows.map((r) => [resultKey(r.source_id, r.model_key), { status: r.status, attempts: Number(r.attempts) || 1, promptVersion: r.prompt_version, takenAt: r.taken_at }]));
  } catch (error) {
    if (missing({ message: error instanceof Error ? error.message : "" })) return null;
    throw error;
  }
}

export interface Spend {
  weekUsd: number;
  callsToday: number;
}

/** Расход на разбор каталога: деньги за 7 дней и вызовы за сегодня (по московской дате). */
export async function loadSpend(db: SupabaseClient, now: Date | number = new Date()): Promise<Spend | null> {
  const today = moscowToday(now);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await db.from(USAGE).select("day,calls,cost_usd").eq("kind", CATALOG_AI_KIND).gte("day", since);
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as Array<{ day: string; calls: number; cost_usd: number | string }>;
  return {
    weekUsd: rows.reduce((sum, r) => sum + Number(r.cost_usd || 0), 0),
    callsToday: rows.filter((r) => String(r.day) === today).reduce((sum, r) => sum + Number(r.calls || 0), 0),
  };
}

type UsageAdd = { calls: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number };

/**
 * Прибавить вызовы к дневному учёту. Сравнение-и-замена по updated_at: два прогона,
 * что идут одновременно (повторная доставка крона, ручной запуск), не перетирают
 * записи друг друга — проигравший перечитывает строку и прибавляет заново.
 */
async function addUsage(db: SupabaseClient, now: Date | number, add: UsageAdd): Promise<void> {
  const day = moscowToday(now);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await db.from(USAGE).select("calls,failed_calls,input_tokens,output_tokens,cost_usd,updated_at").eq("day", day).eq("kind", CATALOG_AI_KIND).maybeSingle();
    if (error) throw new Error(error.message);
    const prev = (data ?? null) as { calls?: number; failed_calls?: number; input_tokens?: number | string; output_tokens?: number | string; cost_usd?: number | string; updated_at?: string } | null;
    const next = {
      calls: Number(prev?.calls ?? 0) + add.calls,
      failed_calls: Number(prev?.failed_calls ?? 0) + add.failed,
      input_tokens: Number(prev?.input_tokens ?? 0) + add.inputTokens,
      output_tokens: Number(prev?.output_tokens ?? 0) + add.outputTokens,
      cost_usd: Math.round((Number(prev?.cost_usd ?? 0) + add.costUsd) * 100_000) / 100_000,
      updated_at: new Date().toISOString(),
    };
    if (!prev) {
      const { error: insertError } = await db.from(USAGE).insert({ day, kind: CATALOG_AI_KIND, ...next });
      if (!insertError) return;
      if (insertError.code !== "23505") throw new Error(insertError.message);
      continue; // строку успел создать другой прогон — перечитаем и прибавим
    }
    const { data: updated, error: updateError } = await db.from(USAGE).update(next).eq("day", day).eq("kind", CATALOG_AI_KIND).eq("updated_at", prev.updated_at).select("day");
    if (updateError) throw new Error(updateError.message);
    if (updated && updated.length > 0) return;
  }
  throw new Error("учёт расхода не записался: строку постоянно обновляет другой прогон");
}

const LOCK_KIND = `lock:${CATALOG_AI_KIND}`;
/** Прогон укладывается в 300 с функции; аренда чуть дольше, чтобы упавший прогон не держал замок до утра. */
const LEASE_MS = 6 * 60 * 1000;
const RELEASED = "1970-01-01T00:00:00.000Z";

/**
 * Замок прогона: один сборщик за раз. Два прогона по одной очереди оплатили бы одни и те же модели
 * дважды. Аренда в строке учёта с особым назначением (на бюджет не влияет). Токен — метка аренды; null — занято.
 */
async function acquireLease(db: SupabaseClient, nowMs: number): Promise<string | null> {
  const day = moscowToday(nowMs);
  const stamp = new Date(nowMs).toISOString();
  const { data, error } = await db.from(USAGE).select("updated_at").eq("day", day).eq("kind", LOCK_KIND).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { error: insertError } = await db.from(USAGE).insert({ day, kind: LOCK_KIND, updated_at: stamp });
    if (!insertError) return stamp;
    if (insertError.code === "23505") return null;
    throw new Error(insertError.message);
  }
  const held = String((data as { updated_at: string }).updated_at);
  if (nowMs - Date.parse(held) < LEASE_MS) return null;
  const { data: taken, error: takeError } = await db.from(USAGE).update({ updated_at: stamp }).eq("day", day).eq("kind", LOCK_KIND).eq("updated_at", held).select("day");
  if (takeError) throw new Error(takeError.message);
  return taken && taken.length > 0 ? stamp : null;
}

async function releaseLease(db: SupabaseClient, nowMs: number, token: string): Promise<void> {
  try {
    await db.from(USAGE).update({ updated_at: RELEASED }).eq("day", moscowToday(nowMs)).eq("kind", LOCK_KIND).eq("updated_at", token);
  } catch {
    // Не снялась — истечёт сама через LEASE_MS.
  }
}

// ---------------------------------------------------------------------------
// Вызов ИИ

export interface VisionAnswer {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Сколько фото реально ушло в вызов (после запасного варианта — одно). */
  images?: number;
}

export type AskVision = (direction: AssortmentDirection, imageUrls: string[], model: string) => Promise<VisionAnswer>;

/** Ошибки, после которых продолжать бессмысленно: ключ, деньги, лимит. */
export class VisionStopError extends Error {
  constructor(message: string, readonly code: "auth" | "billing" | "rate_limit" | "config") {
    super(message);
    this.name = "VisionStopError";
  }
}

export function aiKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Реальный вызов Anthropic: до двух фото модели по ссылкам с сайта бренда, ответ — JSON признаков. */
export const askAnthropicVision: AskVision = async (direction, imageUrls, model) => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 0 });
  const content: Anthropic.MessageCreateParams["messages"][number]["content"] = imageUrls.slice(0, MAX_IMAGES).map((url) => ({ type: "image" as const, source: { type: "url" as const, url } }));
  content.push({ type: "text", text: "Опиши признаки по этим фото." });
  try {
    const response = await client.messages.create({ model, max_tokens: 700, system: aiPrompt(direction), messages: [{ role: "user", content }] });
    return {
      text: response.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch (error) {
    const status = (error as { status?: number }).status;
    const message = error instanceof Error ? error.message : "ошибка Anthropic";
    if (status === 401 || status === 403) throw new VisionStopError(`Anthropic: ключ не принят (${status})`, "auth");
    if (status === 402 || /credit balance|billing/i.test(message)) throw new VisionStopError("Anthropic: на счёте нет средств", "billing");
    if (status === 429) throw new VisionStopError("Anthropic: лимит запросов", "rate_limit");
    // Неверное имя модели — системная ошибка: каждая следующая модель получила бы то же и потратила попытку впустую.
    if (status === 404) throw new VisionStopError(`Anthropic: модель ${model} не найдена`, "config");
    throw error;
  }
};

/**
 * Временный сбой Anthropic или сети: перегрузка, 5xx, обрыв, таймаут. Попытку модели
 * он не тратит: иначе три перегрузки подряд навсегда выводили бы модель из очереди.
 */
export function isTransientVisionError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number" && [408, 409, 500, 502, 503, 504, 529].includes(status)) return true;
  const text = `${(error as Error | null)?.name ?? ""} ${(error as Error | null)?.message ?? ""}`;
  return /APIConnection|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|overloaded/i.test(text);
}

// ---------------------------------------------------------------------------
// Прогон

export interface RunSummary {
  skipped: string | null;
  candidates: number;
  allowed: number;
  allowReason: string;
  done: number;
  failed: number;
  costUsd: number;
  stoppedBy: "budget" | "time" | "auth" | "billing" | "rate_limit" | "config" | "errors" | null;
  /** Временные сбои (перегрузка, сеть): попытка модели не потрачена, она в очереди снова. */
  transient: number;
  /** Источники, пропущенные в этом прогоне: шесть моделей подряд без успеха (фото не скачиваются у Anthropic). */
  deadSources: string[];
  spend: Spend | null;
  stopMessage: string | null;
}

export interface RunOptions {
  ask: AskVision;
  config?: CatalogAiConfig;
  now?: () => number;
  /** Не начинать новую пачку после этого времени с начала прогона, мс. */
  startBudgetMs?: number;
  /** Моделей за один прогон. */
  runCap?: number;
  /** Сколько моделей в работе одновременно. */
  parallel?: number;
  dryRun?: boolean;
}

/**
 * Один прогон: считает, сколько разрешают бюджет недели и потолок суток, берёт
 * очередь (сначала новые модели) и разбирает пачками. Расход записывается ПОСЛЕ
 * каждого ответа, а бюджет проверяется ДО каждой пачки — перерасхода больше
 * пачки не бывает.
 */
export async function runCatalogAi(db: SupabaseClient, options: RunOptions): Promise<RunSummary> {
  const config = options.config ?? catalogAiConfig();
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  const startBudget = options.startBudgetMs ?? 150_000;
  const runCap = options.runCap ?? 120;
  const parallel = Math.max(1, options.parallel ?? 3);
  const summary: RunSummary = { skipped: null, candidates: 0, allowed: 0, allowReason: "ok", done: 0, failed: 0, transient: 0, deadSources: [], costUsd: 0, stoppedBy: null, spend: null, stopMessage: null };

  if (!config.enabled) return { ...summary, skipped: "выключено (ASSORTMENT_CATALOG_AI=off)" };
  if (!config.price) return { ...summary, skipped: `нет цены модели ${config.model}: бюджет нечем считать — задайте ASSORTMENT_CATALOG_AI_PRICE_IN/OUT` };

  const spend = await loadSpend(db, startedAt);
  if (!spend) return { ...summary, skipped: "нет таблиц признаков (миграция 202610050005)" };
  summary.spend = spend;
  const first = allowance(config, spend.weekUsd, spend.callsToday, runCap);
  summary.allowReason = first.reason;
  // Бюджет недели или потолок суток исчерпаны — каталог и таблицу результатов не читаем вовсе (за сутки таких прогонов
  // до десяти): ни тяжёлых выборок, ни замка, ни строки в журнале.
  if (!options.dryRun && first.models === 0) return { ...summary, stoppedBy: first.reason === "run_cap" ? null : "budget" };

  // Замок берём до чтения очереди: иначе прогон, стартовавший в конце чужого, читает уже устаревший расход и результаты.
  const lease = options.dryRun ? "dry" : await acquireLease(db, startedAt);
  if (!lease) return { ...summary, skipped: "уже идёт другой прогон" };
  try {
    const existing = await loadExisting(db);
    if (!existing) return { ...summary, skipped: "нет таблиц признаков (миграция 202610050005)" };
    const heads = await loadCatalogHeads(db, null, startedAt);
    if (!heads) return { ...summary, skipped: "нет вида каталога (миграция 202610050002)" };
    const queue = pickCandidates(heads, existing, startedAt, Number.MAX_SAFE_INTEGER);
    summary.candidates = queue.length;
    summary.allowed = Math.min(first.models, queue.length);
    if (options.dryRun || queue.length === 0) return summary;
    return await processQueue(db, queue, existing, config, options, summary, spend, { startedAt, startBudget, runCap, parallel, now });
  } finally {
    if (lease !== "dry") await releaseLease(db, startedAt, lease);
  }
}

async function processQueue(
  db: SupabaseClient, queue: CatalogHead[], existing: Map<string, ExistingResult>, config: CatalogAiConfig, options: RunOptions,
  summary: RunSummary, spend: Spend, ctx: { startedAt: number; startBudget: number; runCap: number; parallel: number; now: () => number },
): Promise<RunSummary> {
  const { startedAt, startBudget, runCap, parallel, now } = ctx;

  let weekUsd = spend.weekUsd;
  let callsToday = spend.callsToday;
  let doneInRun = 0;
  let deadBatches = 0;
  // Источник, у которого в этом прогоне шесть моделей подряд не разобрались (фото не скачиваются), пропускаем до конца
  // прогона: иначе он съедает пачки, а остальные источники ждут. Временные сбои (сеть, перегрузка) источник не «убивают».
  const lanes = new Map<string, { ok: number; failed: number }>();
  const isDead = (sourceId: string) => {
    const lane = lanes.get(sourceId);
    return Boolean(lane) && lane!.ok === 0 && lane!.failed >= SOURCE_DEAD_FAILS;
  };
  let cursor = 0;
  while (cursor < queue.length) {
    if (now() - startedAt > startBudget) {
      summary.stoppedBy = "time";
      break;
    }
    const left = allowance(config, weekUsd, callsToday, runCap - doneInRun);
    if (left.models === 0) {
      // Упёрлись только в размер прогона — это не нехватка бюджета: следующий прогон продолжит.
      summary.stoppedBy = left.reason === "run_cap" ? null : "budget";
      break;
    }
    const batch: CatalogHead[] = [];
    while (cursor < queue.length && batch.length < Math.min(parallel, left.models)) {
      const next = queue[cursor];
      cursor += 1;
      if (!isDead(next.sourceId)) batch.push(next);
    }
    if (batch.length === 0) break;
    const outcomes = await Promise.all(batch.map((head) => analyzeOne(db, head, existing, config, options.ask, now)));
    batch.forEach((head, index) => {
      const outcome = outcomes[index];
      const lane = lanes.get(head.sourceId) ?? { ok: 0, failed: 0 };
      if (outcome.status === "ok") lane.ok += 1;
      else if (!outcome.transient && !outcome.stop) lane.failed += 1;
      lanes.set(head.sourceId, lane);
    });
    let batchCost = 0;
    let batchTokens = { in: 0, out: 0 };
    let ok = 0;
    let failed = 0;
    let transient = 0;
    let stop: VisionStopError | null = null;
    for (const outcome of outcomes) {
      batchCost += outcome.costUsd;
      batchTokens = { in: batchTokens.in + outcome.inputTokens, out: batchTokens.out + outcome.outputTokens };
      if (outcome.status === "ok") ok += 1;
      else if (outcome.transient) transient += 1;
      else failed += 1;
      if (outcome.stop) stop = outcome.stop;
    }
    // Расход пишем сразу после пачки: сорвётся следующая — потраченное уже учтено. Не записался — стоп:
    // платить дальше вслепую нельзя, а уже полученные результаты и расход прогона в ответе остаются.
    let usageError: string | null = null;
    try {
      await addUsage(db, now(), { calls: batch.length, failed: failed + transient, inputTokens: batchTokens.in, outputTokens: batchTokens.out, costUsd: batchCost });
    } catch (error) {
      usageError = error instanceof Error ? error.message : "ошибка записи";
    }
    weekUsd += batchCost;
    callsToday += batch.length;
    doneInRun += batch.length;
    summary.done += ok;
    summary.failed += failed;
    summary.transient += transient;
    summary.costUsd = Math.round((summary.costUsd + batchCost) * 100_000) / 100_000;
    if (usageError) {
      summary.stoppedBy = "errors";
      summary.stopMessage = `расход не записался в учёт (${usageError.slice(0, 120)}): остановлено, чтобы не платить вслепую`;
      break;
    }
    if (stop) {
      summary.stoppedBy = stop.code;
      summary.stopMessage = stop.message;
      break;
    }
    // Четыре пачки подряд без единого успеха — похоже на системный сбой (сеть, ответ ИИ), а не на мёртвые фото одного
    // источника: стоп, а не сто двадцать пустых попыток. Мёртвые фото отдельных моделей пачку «не убивают».
    deadBatches = ok === 0 ? deadBatches + 1 : 0;
    if (deadBatches >= DEAD_BATCHES_STOP) {
      summary.stoppedBy = "errors";
      summary.stopMessage = `${DEAD_BATCHES_STOP} пачки подряд без единого разобранного фото`;
      break;
    }
  }
  summary.deadSources = [...lanes.keys()].filter(isDead).sort();
  summary.spend = { weekUsd, callsToday };
  return summary;
}

interface Outcome {
  status: "ok" | "failed";
  /** Временный сбой: попытка модели не записана. */
  transient?: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  stop?: VisionStopError;
}

/** Два фото; не скачалось второе — пробуем по первому: сбой на скачивании ничего не стоит. */
async function askWithFallback(ask: AskVision, head: CatalogHead, model: string): Promise<VisionAnswer> {
  const urls = head.imageUrls.slice(0, MAX_IMAGES);
  try {
    return { ...(await ask(head.direction, urls, model)), images: urls.length };
  } catch (error) {
    if (error instanceof VisionStopError || urls.length < 2) throw error;
    return { ...(await ask(head.direction, urls.slice(0, 1), model)), images: 1 };
  }
}

async function analyzeOne(db: SupabaseClient, head: CatalogHead, existing: Map<string, ExistingResult>, config: CatalogAiConfig, ask: AskVision, now: () => number): Promise<Outcome> {
  const prev = existing.get(resultKey(head.sourceId, head.modelKey));
  const attempts = (prev?.status === "failed" ? prev.attempts : 0) + 1;
  const base = {
    source_id: head.sourceId,
    model_key: head.modelKey,
    direction: head.direction,
    source_item_id: head.sourceItemId,
    image_count: Math.min(head.imageUrls.length, MAX_IMAGES),
    prompt_version: PROMPT_VERSION,
    model: config.model,
    attempts,
    taken_at: new Date(now()).toISOString(),
  };
  const save = async (row: Record<string, unknown>) => {
    const { error } = await db.from(RESULTS).upsert({ ...base, ...row }, { onConflict: "source_id,model_key" });
    if (error) throw new Error(error.message);
  };
  /**
   * Неудача модели. Если у неё уже есть хороший результат (пересбор по новой версии вопроса), он не затирается:
   * только отметка о попытке — срок следующей попытки считается от неё.
   */
  const recordFailure = async (message: string, usage: Record<string, unknown>) => {
    if (prev?.status === "ok") {
      const { error } = await db.from(RESULTS).update({ last_error: message.slice(0, 300), taken_at: base.taken_at, attempts: prev.attempts + 1 }).eq("source_id", head.sourceId).eq("model_key", head.modelKey);
      if (error) throw new Error(error.message);
      return;
    }
    await save({ status: "failed", attributes: null, last_error: message.slice(0, 300), ...usage });
  };

  let answer: VisionAnswer;
  try {
    answer = await askWithFallback(ask, head, config.model);
  } catch (error) {
    if (error instanceof VisionStopError) return { status: "failed", costUsd: 0, inputTokens: 0, outputTokens: 0, stop: error };
    if (isTransientVisionError(error)) return { status: "failed", transient: true, costUsd: 0, inputTokens: 0, outputTokens: 0 };
    // Фото не скачалось, ответ не тот: запоминаем попытку, чтобы не биться в одну и ту же модель каждый прогон.
    try {
      await recordFailure(error instanceof Error ? error.message : "ошибка", { input_tokens: null, output_tokens: null, cost_usd: 0 });
    } catch {
      // Не записалось — модель просто попадёт в очередь снова.
    }
    return { status: "failed", costUsd: 0, inputTokens: 0, outputTokens: 0 };
  }

  // Ответ получен и оплачен: что бы дальше ни случилось с записью, расход этого вызова в учёте есть.
  const cost = costUsd({ inputTokens: answer.inputTokens, outputTokens: answer.outputTokens }, config.price!);
  const paid = { costUsd: cost, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens };
  const usage = { input_tokens: answer.inputTokens, output_tokens: answer.outputTokens, cost_usd: cost };
  try {
    const attributes: StoredAttributes | null = parseCatalogAnswer(head.direction, answer.text);
    if (!attributes) {
      await recordFailure("ответ ИИ не разобрался в признаки", usage);
      return { status: "failed", ...paid };
    }
    await save({ status: "ok", attributes, last_error: null, image_count: answer.images ?? base.image_count, ...usage });
    return { status: "ok", ...paid };
  } catch {
    return { status: "failed", ...paid };
  }
}

// ---------------------------------------------------------------------------
// Отчёт

/** Признаки по фото для вкладки «Формы»; null — таблицы ещё нет или ничего не разобрано. */
export async function loadPhotoTraits(db: SupabaseClient, direction: AssortmentDirection, nowMs = Date.now()): Promise<PhotoTraitsReport | null> {
  const heads = await loadCatalogHeads(db, direction, nowMs);
  if (!heads) return null;
  const current = new Map(heads.map((h) => [resultKey(h.sourceId, h.modelKey), h]));
  const { data: names } = await db.from("assortment_sources").select("source_id,name");
  const nameOf = new Map((names ?? []).map((n) => [String((n as { source_id: string }).source_id), String((n as { name: string | null }).name ?? "")]));
  try {
    const rows = await loadAllSupabasePages<{ source_id: string; model_key: string; attributes: StoredAttributes | null }>((from, to) => db.from(RESULTS)
      .select("source_id,model_key,attributes")
      .eq("direction", direction)
      .eq("status", "ok")
      .order("source_id", { ascending: true })
      .order("model_key", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Array<{ source_id: string; model_key: string; attributes: StoredAttributes | null }> | null; error: { message: string } | null }>, { label: "Признаки по фото", pageSize: 1000 });
    const models: TraitModel[] = rows
      .filter((r) => r.attributes && current.has(resultKey(r.source_id, r.model_key)))
      .map((r) => ({ sourceId: r.source_id, sourceName: nameOf.get(r.source_id) || r.source_id, attributes: r.attributes as StoredAttributes }));
    if (models.length === 0) return null;
    // Знаменатель покрытия — модели, которые вообще можно разобрать: с фото и не «Рынок РФ».
    const eligible = heads.filter((h) => h.imageUrls.length > 0 && !isRuSource(h.sourceId)).length;
    return buildPhotoTraits(direction, models, Math.max(eligible, models.length));
  } catch (error) {
    if (missing({ message: error instanceof Error ? error.message : "" })) return null;
    throw error;
  }
}
