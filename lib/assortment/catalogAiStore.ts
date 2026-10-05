import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowToday } from "@/lib/sync/moscowDay";
import { catalogPrompt, catalogUserText } from "./aiAttributes";
import { ATTRIBUTE_FIELDS } from "./attributes";
import { CATALOG_SEEN_DAYS } from "./catalog";
import {
  allowance, buildPhotoTraits, catalogAiConfig, CATALOG_AI_KIND, costUsd, estimatedCallUsd, parseCatalogAnswer, pickCandidates, polzaKey, PROMPT_VERSION, resultKey,
  type CatalogAiConfig, type CatalogProvider, type CatalogHead, type ExistingResult, type PhotoTraitsReport, type StoredAttributes, type TraitModel,
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
/** Сколько 403 Polza с начала прогона без единого успеха считаем проблемой ключа, а не отказом по запросам. */
const FORBIDDEN_STOP = 6;

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
  /** Почему ответ закончился (stop / length / …): length без разобранного JSON — ответ обрезан по лимиту токенов. */
  finishReason?: string;
  /** Расход вызова в $, если провайдер сам сообщил его (Polza — usage.cost_rub по курсу); иначе считаем по токенам и цене модели. */
  costUsd?: number;
  /** Сколько фото реально ушло в вызов (после запасного варианта — одно). */
  images?: number;
}

/** Вызов ИИ: раздел, до двух фото, модель, название товара с сайта (подсказка к вопросу, необязательно). */
export type AskVision = (direction: AssortmentDirection, imageUrls: string[], model: string, title?: string | null) => Promise<VisionAnswer>;

/** Ошибки, после которых продолжать бессмысленно: ключ, деньги, лимит. */
export class VisionStopError extends Error {
  constructor(message: string, readonly code: "auth" | "billing" | "rate_limit" | "config") {
    super(message);
    this.name = "VisionStopError";
  }
}

/** Есть ли ключ выбранного провайдера (значения не читаем и не показываем — только факт). */
export function aiKeyConfigured(provider: CatalogProvider = "anthropic", env: Record<string, string | undefined> = process.env): boolean {
  if (provider === "polza") return Boolean(polzaKey(env));
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

const POLZA_URL = "https://polza.ai/api/v1/chat/completions";

/** Короткий кусок текста ошибки провайдера для сообщения владельцу: без переносов, не длиннее 160 знаков. */
function snippet(text: unknown): string {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * Polza.ai: тот же вопрос, до двух фото по ссылкам, OpenAI-совместимый формат. Ответ несёт usage.cost_rub — сколько
 * реально списано в рублях; по курсу это и есть расход вызова в учёте (цена модели из таблицы нужна только для оценки
 * «сколько вызовов влезет» до ответа).
 *
 * Ошибки (по документации Polza): 401 — ключ; 402 / INSUFFICIENT_BALANCE — нет средств или исчерпан лимит расходов
 * ключа; 429 — лимит запросов; 404 или «нет провайдеров для модели» — неверная модель: всё это останавливает прогон.
 * 403 — «доступ запрещён, в том числе запрос отклонён модерацией»: чаще отказ по конкретному запросу, чем ключ, поэтому
 * это неудача МОДЕЛИ (прогон остановится, только если 403 пошли подряд без единого успеха). 408 и любые 5xx — временные
 * (в том числе 503 «провайдер недоступен», даже с noProvidersForModel). Остальное (фото не скачалось) — неудача модели.
 */
export function makePolzaVision(rubPerUsd: number, fetchImpl: typeof fetch = fetch): AskVision {
  return async (direction, imageUrls, model, title) => {
    const key = polzaKey();
    const response = await fetchImpl(POLZA_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        // Рассуждения (thinking) для описания признаков по фото не нужны, а их токены входят в ответ и стоят как ответ:
        // у Gemini выключаем (документированный reasoning.effort = "none"). Остальным моделям параметр не шлём.
        ...(model.startsWith("google/") ? { reasoning: { effort: "none" } } : {}),
        max_tokens: 3000,
        messages: [
          { role: "system", content: catalogPrompt(direction) },
          { role: "user", content: [{ type: "text", text: catalogUserText(title) }, ...imageUrls.slice(0, MAX_IMAGES).map((url) => ({ type: "image_url", image_url: { url } }))] },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });
    const payload = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost_rub?: number | string; cost?: number | string };
      error?: { code?: string; message?: string; metadata?: { reason?: string } };
    } | null;
    if (!response.ok) {
      const code = payload?.error?.code ?? "";
      const message = payload?.error?.message || `Polza вернула ${response.status}`;
      const detail = snippet(message);
      if (response.status === 401) throw new VisionStopError(`Polza: ключ не принят (401): ${detail}`, "auth");
      if (response.status === 402 || code === "INSUFFICIENT_BALANCE") throw new VisionStopError(`Polza: на счёте нет средств или исчерпан лимит расходов ключа: ${detail}`, "billing");
      if (response.status === 429) throw new VisionStopError(`Polza: лимит запросов: ${detail}`, "rate_limit");
      // Временное раньше «модели нет»: 503 с noProvidersForModel — «провайдер недоступен», а не неверная модель.
      if (response.status === 408 || response.status >= 500) throw Object.assign(new Error(message), { status: response.status });
      if (response.status === 404 || payload?.error?.metadata?.reason === "noProvidersForModel") throw new VisionStopError(`Polza: модель ${model} недоступна: ${detail}`, "config");
      // 403 и остальное: отказ по этому запросу, а не остановка всего прогона.
      throw Object.assign(new Error(`Polza ${response.status}: ${detail}`), { status: response.status, forbidden: response.status === 403 });
    }
    // 200, но тела нет или оно без choices (оборвано чтение): это не «разобрали пустое», а сбой сети — временный.
    if (!payload || !Array.isArray(payload.choices) || payload.choices.length === 0) {
      throw Object.assign(new Error("Polza: ответ без содержимого (обрыв чтения)"), { status: 502 });
    }
    const content = payload.choices[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => (part && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("\n") : "";
    const rub = Number(payload.usage?.cost_rub ?? payload.usage?.cost);
    return {
      text,
      finishReason: payload.choices[0]?.finish_reason,
      inputTokens: Number(payload.usage?.prompt_tokens) || 0,
      outputTokens: Number(payload.usage?.completion_tokens) || 0,
      costUsd: Number.isFinite(rub) && rub >= 0 && payload.usage && (payload.usage.cost_rub != null || payload.usage.cost != null) ? Math.round((rub / rubPerUsd) * 100_000) / 100_000 : undefined,
    };
  };
}

/** Вызов ИИ для настроенного провайдера. */
export function askFor(config: CatalogAiConfig): AskVision {
  return config.provider === "polza" ? makePolzaVision(config.rubPerUsd) : askAnthropicVision;
}

/** Реальный вызов Anthropic: до двух фото модели по ссылкам с сайта бренда, ответ — JSON признаков. */
export const askAnthropicVision: AskVision = async (direction, imageUrls, model, title) => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 0 });
  const content: Anthropic.MessageCreateParams["messages"][number]["content"] = imageUrls.slice(0, MAX_IMAGES).map((url) => ({ type: "image" as const, source: { type: "url" as const, url } }));
  content.push({ type: "text", text: catalogUserText(title) });
  try {
    const response = await client.messages.create({ model, max_tokens: 700, system: catalogPrompt(direction), messages: [{ role: "user", content }] });
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
  /** Машинная причина пропуска: no_price — модель без цены (ошибка настройки, о ней должно быть слышно). */
  skippedBecause?: "no_price";
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
  if (!config.price) {
    const hint = config.provider === "polza"
      ? `выберите модель из таблицы POLZA_PRICES_RUB или задайте ASSORTMENT_CATALOG_AI_POLZA_PRICE_IN_RUB и ASSORTMENT_CATALOG_AI_POLZA_PRICE_OUT_RUB (₽ за млн токенов)`
      : `задайте ASSORTMENT_CATALOG_AI_PRICE_IN и ASSORTMENT_CATALOG_AI_PRICE_OUT ($ за млн токенов)`;
    const wrongProvider = config.provider === "anthropic" && config.model.includes("/") ? " (имя вида «автор/модель» — это модель Polza: задайте ASSORTMENT_CATALOG_AI_PROVIDER=polza)" : "";
    return { ...summary, skipped: `нет цены модели ${config.model} у провайдера ${config.provider === "polza" ? "Polza" : "Anthropic"}${wrongProvider}: бюджет нечем считать — ${hint}`, skippedBecause: "no_price" };
  }

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
  let forbiddenInRun = 0;
  let lastError = "";
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
      if (outcome.errorMessage) lastError = outcome.errorMessage;
      if (outcome.forbidden) forbiddenInRun += 1;
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
    // 403 у Polza — чаще отказ по конкретному запросу (модерация), но если с самого начала прогона их шесть и ни одной
    // разобранной модели, это уже про ключ или права: стоп как «ключ/права», а не молчаливая трата попыток.
    if (summary.done === 0 && forbiddenInRun >= FORBIDDEN_STOP) {
      summary.stoppedBy = "auth";
      summary.stopMessage = `Polza вернула 403 на ${forbiddenInRun} моделях без единого успеха: проверьте ключ, права и модерацию (${lastError.slice(0, 120)})`;
      break;
    }
    // Четыре пачки подряд без единого успеха — похоже на системный сбой (сеть, ответ ИИ), а не на мёртвые фото одного
    // источника: стоп, а не сто двадцать пустых попыток. Мёртвые фото отдельных моделей пачку «не убивают».
    deadBatches = ok === 0 ? deadBatches + 1 : 0;
    if (deadBatches >= DEAD_BATCHES_STOP) {
      summary.stoppedBy = "errors";
      summary.stopMessage = `${DEAD_BATCHES_STOP} пачки подряд без единого разобранного фото${lastError ? `: ${lastError.slice(0, 120)}` : ""}`;
      break;
    }
  }
  summary.deadSources = [...lanes.keys()].filter(isDead).sort();
  summary.spend = { weekUsd, callsToday };
  return summary;
}

interface Outcome {
  status: "ok" | "failed";
  /** Текст ошибки неудачи модели — для сообщения остановки и журнала. */
  errorMessage?: string;
  /** 403 Polza (модерация или права): отказ по запросу; серия таких без единого успеха — признак ключа. */
  forbidden?: boolean;
  /** Временный сбой: попытка модели не записана. */
  transient?: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  stop?: VisionStopError;
}

/**
 * Два фото; не скачалось второе — пробуем по первому: сбой на скачивании ничего не стоит. После таймаута, 5xx или обрыва
 * сети запасного вызова нет: первый мог дойти до модели и быть оплачен (Polza оплачивает уже сгенерированное при обрыве
 * со стороны клиента), а второй удвоил бы расход и время модели.
 */
async function askWithFallback(ask: AskVision, head: CatalogHead, model: string): Promise<VisionAnswer> {
  const urls = head.imageUrls.slice(0, MAX_IMAGES);
  try {
    return { ...(await ask(head.direction, urls, model, head.title)), images: urls.length };
  } catch (error) {
    if (error instanceof VisionStopError || urls.length < 2 || isTransientVisionError(error) || (error as { forbidden?: boolean })?.forbidden) throw error;
    return { ...(await ask(head.direction, urls.slice(0, 1), model, head.title)), images: 1 };
  }
}

/** Обрыв по нашему таймауту: запрос мог дойти до модели и быть оплачен, хотя ответа мы не получили. */
function isTimeoutError(error: unknown): boolean {
  const name = (error as Error | null)?.name ?? "";
  return name === "TimeoutError" || name === "AbortError" || /timed out|timeout|aborted/i.test((error as Error | null)?.message ?? "");
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
    model: config.provider === "polza" ? `polza:${config.model}` : config.model,
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
    if (isTransientVisionError(error)) {
      // Обрыв по таймауту у Polza оплачивается (уже сгенерированная часть), а ответа с суммой нет: пишем оценку вызова,
      // а не ноль — иначе бюджет недели недосчитывает именно самые долгие вызовы. Остальные временные сбои (5xx,
      // перегрузка) провайдер не списывает.
      const estimate = isTimeoutError(error) && config.price ? estimatedCallUsd(config.price, config.provider === "polza" ? 1500 : 600) : 0;
      return { status: "failed", transient: true, costUsd: estimate, inputTokens: 0, outputTokens: 0 };
    }
    // Фото не скачалось, ответ не тот: запоминаем попытку, чтобы не биться в одну и ту же модель каждый прогон.
    const message = error instanceof Error ? error.message : "ошибка";
    try {
      await recordFailure(message, { input_tokens: null, output_tokens: null, cost_usd: 0 });
    } catch {
      // Не записалось — модель просто попадёт в очередь снова.
    }
    return { status: "failed", errorMessage: message, forbidden: Boolean((error as { forbidden?: boolean })?.forbidden), costUsd: 0, inputTokens: 0, outputTokens: 0 };
  }

  // Ответ получен и оплачен: что бы дальше ни случилось с записью, расход этого вызова в учёте есть.
  const cost = answer.costUsd ?? costUsd({ inputTokens: answer.inputTokens, outputTokens: answer.outputTokens }, config.price!);
  const paid = { costUsd: cost, inputTokens: answer.inputTokens, outputTokens: answer.outputTokens };
  const usage = { input_tokens: answer.inputTokens, output_tokens: answer.outputTokens, cost_usd: cost };
  try {
    const attributes: StoredAttributes | null = parseCatalogAnswer(head.direction, answer.text);
    if (!attributes) {
      // Ответ оборван по лимиту токенов — отдельная причина (у моделей с рассуждениями так бывает), а не «не разобрался».
      const why = answer.finishReason === "length" ? "ответ обрезан по лимиту токенов (finish_reason=length)" : "ответ ИИ не разобрался в признаки";
      await recordFailure(why, usage);
      return { status: "failed", errorMessage: why, ...paid };
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

// ---------------------------------------------------------------------------
// Примеры разбора — проверить глазами, что ИИ описывает фото верно

export interface PhotoSample {
  sourceId: string;
  sourceName: string;
  title: string;
  imageUrl: string | null;
  model: string | null;
  takenAt: string | null;
  attributes: Array<{ key: string; label: string; value: string | null; notVisible: boolean; confidence: number | null }>;
}

/** Простой устойчивый хэш (FNV-1a, 32 бита): порядок «случайной» выборки зависит от зерна и ключа модели, а не от порядка строк в базе. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Случайные модели каталога с тем, что про них написал ИИ, и фото — владелец сверяет описание с картинкой, прежде чем
 * верить долям признаков. Выборка идёт по кругу между источниками (иначе её целиком заняли бы JW PEI и Zara), порядок
 * зависит от зерна: другое зерно — другие примеры. null — таблицы ещё нет.
 */
export async function loadPhotoSamples(
  db: SupabaseClient,
  direction: AssortmentDirection,
  options: { limit?: number; seed?: string; nowMs?: number } = {},
): Promise<{ samples: PhotoSample[]; analyzed: number } | null> {
  const limit = Math.max(1, Math.min(options.limit ?? 12, 24));
  const heads = await loadCatalogHeads(db, direction, options.nowMs ?? Date.now());
  if (!heads) return null;
  const current = new Map(heads.map((h) => [resultKey(h.sourceId, h.modelKey), h]));
  const { data: names } = await db.from("assortment_sources").select("source_id,name");
  const nameOf = new Map((names ?? []).map((n) => [String((n as { source_id: string }).source_id), String((n as { name: string | null }).name ?? "")]));
  type Row = { source_id: string; model_key: string; attributes: StoredAttributes | null; model: string | null; taken_at: string | null };
  try {
    const rows = await loadAllSupabasePages<Row>((from, to) => db.from(RESULTS)
      .select("source_id,model_key,attributes,model,taken_at")
      .eq("direction", direction)
      .eq("status", "ok")
      .order("source_id", { ascending: true })
      .order("model_key", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>, { label: "Примеры разбора по фото", pageSize: 1000 });
    const usable = rows.filter((r) => r.attributes && Object.keys(r.attributes).length > 0 && current.has(resultKey(r.source_id, r.model_key)));
    const seed = options.seed ?? "";
    const lanes = new Map<string, Row[]>();
    for (const row of usable.slice().sort((a, b) => fnv1a(`${seed}|${a.source_id}|${a.model_key}`) - fnv1a(`${seed}|${b.source_id}|${b.model_key}`))) {
      const lane = lanes.get(row.source_id) ?? [];
      lane.push(row);
      lanes.set(row.source_id, lane);
    }
    const order = [...lanes.keys()].sort((a, b) => fnv1a(`${seed}|${a}`) - fnv1a(`${seed}|${b}`));
    const picked: Row[] = [];
    for (let round = 0; picked.length < limit && round < limit; round += 1) {
      for (const id of order) {
        const row = lanes.get(id)?.[round];
        if (row && picked.length < limit) picked.push(row);
      }
    }
    const samples: PhotoSample[] = picked.map((row) => {
      const head = current.get(resultKey(row.source_id, row.model_key))!;
      const stored = row.attributes as StoredAttributes;
      return {
        sourceId: row.source_id,
        sourceName: nameOf.get(row.source_id) || row.source_id,
        title: head.title,
        imageUrl: head.imageUrls[0] ?? null,
        model: row.model,
        takenAt: row.taken_at,
        attributes: ATTRIBUTE_FIELDS[direction].filter((f) => stored[f.key]).map((f) => ({
          key: f.key,
          label: f.label,
          value: stored[f.key].nv ? null : stored[f.key].v,
          notVisible: Boolean(stored[f.key].nv) || !stored[f.key].v,
          confidence: typeof stored[f.key].c === "number" ? stored[f.key].c! : null,
        })),
      };
    });
    return { samples, analyzed: usable.length };
  } catch (error) {
    if (missing({ message: error instanceof Error ? error.message : "" })) return null;
    throw error;
  }
}
