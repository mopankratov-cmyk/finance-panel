import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { moscowToday } from "@/lib/sync/moscowDay";
import { CHINA_STOP_WORDS, chinaKeyConfigured, chinaKeyRaw, parseAk } from "./china1688";
import { chinaTranslatorFromEnv, isTranslateStop, translateBatchMaxUsd, type TranslateSetup } from "./chinaSync";
import { ENGINE_KIND, engineBudgetConfig, engineRefusal } from "./engineBudget";
import { addEngineUsage, loadEngineWeekForSpend } from "./engineBudgetStore";
import { isMissingAssortmentSchema } from "./errors";
import {
  factoryErrorState, makeFactoryCallers, parseCompanyRisk, parseCompanySearch, parseFactoryProducts, parseSourceSuppliers, statusActive, entityFromType,
  type CompanyCandidate, type FactoryCallers, type FactorySourceStatus, type FactoryOffer, type SupplierFactory,
} from "./factories1688";
import { buildFactoryResult, normalizeCompanyName, registryFacts, type FactoryCard, type RegistryFacts } from "./factoryCards";
import { clusterByKey, entityFromName, type FactoryClusterKey } from "./factoryGuide";
import { FACTORY_MIGRATION, FACTORY_SEARCH_TABLE, purgeExpiredSearches, saveRegistryCheck } from "./factoryShortlist";

export { FACTORY_MIGRATION, FACTORY_SEARCH_TABLE };

/**
 * «Фабрики сумок (1688)»: поиск фабрик по кнопке, перевод запроса, кэш на 7 дней, проверка компании в 88查, учёт и потолки запросов.
 *
 * Поиск: запрос по-русски → перевод на китайский дешёвым ИИ (тот же перевод Polza, что у трендов: статья cn_translate, общий потолок
 * движка; без Polza человек пишет по-китайски сам) → китайский текст виден и правится → чип кластера дописывается к запросу → два запроса
 * к 1688 разом: поиск поставщиков (source_suppliers) и поиск товаров (find.product, по продажам, 40). Повтор того же запроса за 7 дней —
 * из кэша, без запросов к 1688 (кэшируется только полная выдача: оба источника ответили). Запросы к 1688 стоят 0 $, но считаются
 * (assortment_ai_usage, статья cn_1688_factory): на поиск — не больше двух, на проверку компании — двух (поиск по названию и риски по коду,
 * каждый по своей кнопке), в сутки — FACTORY_DAILY_CALLS; запросы бронируются в учёте ДО обращения к 1688 (сравнение-и-замена), поэтому
 * параллельные поиски потолок не перешагнут. Без ключа 1688 — ни одного запроса (и вкладки нет); без миграции — поиск без кэша.
 */

export const FACTORY_USAGE_KIND = ENGINE_KIND.cn1688Factory;
export const FACTORY_TRANSLATE_KIND = ENGINE_KIND.cnTranslate;
/** Запросов к 1688 на один поиск (поиск поставщиков + поиск товаров) и на одну проверку компании (поиск + риски). */
export const FACTORY_CALLS_PER_SEARCH = 2;
export const FACTORY_CALLS_PER_CHECK = 2;
/** Потолок запросов раздела в московские сутки (лимиты 1688 неизвестны; подобрать после живой пробы). */
export const FACTORY_DAILY_CALLS = 60;
export const FACTORY_CACHE_DAYS = 7;
/** Китайский запрос не длиннее (с кластером — до 80, как в миграции). */
export const FACTORY_QUERY_MAX = 60;
export const FACTORY_QUERY_RU_MAX = 200;

/** Что ещё не проверено вживую — подпись для экрана и журнала. */
export const FACTORY_UNVERIFIED_NOTE = "поиск поставщиков и 88查 вживую не проверены (ключ для пробы не выдан): разбор — по исходникам официальных навыков 1688";

export const FACTORY_QUERY_PROMPT = [
  "Ты переводишь поисковый запрос байера женских сумок с русского на китайский для поиска фабрик и товаров на оптовом сайте 1688.",
  "Переводи коротко, словами китайских продавцов: вид сумки, материал, заметная деталь; перевод — не длиннее 60 знаков.",
  "Ничего не добавляй от себя: ни брендов, ни регионов, ни слов «工厂» или «源头».",
  "Ответ — только JSON-массив строк той же длины и в том же порядке, без пояснений.",
].join(" ");

const DAY_MS = 24 * 3600 * 1000;
const USAGE = "assortment_ai_usage";
const HAN_RE = /\p{Script=Han}/u;

function missing(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || isMissingAssortmentSchema(new Error(error.message ?? ""));
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Секрет сервера: псевдонимы продавцов и подпись кандидатов 88查

/**
 * Ключ HMAC для своей задачи (purpose): из ASSORTMENT_FACTORY_SALT, если задан, иначе — из секрета ключа 1688 (он есть всегда, когда
 * вкладка работает). В ответы и в базу не уходит. Смена ключа 1688 без ASSORTMENT_FACTORY_SALT меняет псевдонимы ИП — тогда «уже в
 * шорт-листе» узнаётся по общей карточке 1688 (addToShortlist). null — секрета нет.
 */
export function factorySecret(env: Record<string, string | undefined>, purpose: string): Buffer | null {
  const base = env.ASSORTMENT_FACTORY_SALT?.trim() || parseAk(chinaKeyRaw(env))?.secret || "";
  if (!base) return null;
  return createHash("sha256").update(`assortment-cn-factory:${purpose}\u0000${base}`, "utf8").digest();
}

/**
 * Псевдоним продавца для ключа шорт-листа: «ps:» + HMAC-SHA256 нормализованного названия. Название не хранится, а тот же продавец в
 * другом поиске получает тот же ключ (и ту же запись шорт-листа). По 152-ФЗ это псевдоним, а не обезличивание — решение владельца 07.10:
 * у ИП храним псевдоним и ссылку. null — секрета нет (тогда у ИП ключа нет и «В шорт-лист» не показывается).
 */
export function factorySellerKey(env: Record<string, string | undefined> = process.env): ((normalizedName: string) => string | null) | null {
  const secret = factorySecret(env, "seller-pseudonym");
  if (!secret) return null;
  return (norm) => (norm ? `ps:${createHmac("sha256", secret).update(norm, "utf8").digest("hex")}` : null);
}

// ---------------------------------------------------------------------------
// Запрос

/** Китайский запрос: NFKC, без управляющих символов, пробелы схлопнуты; должен содержать иероглифы и быть не длиннее FACTORY_QUERY_MAX. */
export function normalizeQueryZh(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const q = text.normalize("NFKC").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  if (!q || q.length > FACTORY_QUERY_MAX || !HAN_RE.test(q)) return null;
  return q;
}

/** Чип кластера дописывается к запросу (слова, которых в запросе ещё нет) — запрос остаётся виден человеку целиком. */
export function composeQuery(queryZh: string, cluster: FactoryClusterKey | null | undefined): string {
  const words = clusterByKey(cluster ?? null)?.query?.split(" ") ?? [];
  const add = words.filter((w) => w && !queryZh.includes(w));
  return add.length ? `${queryZh} ${add.join(" ")}` : queryZh;
}

export function factoryQueryKey(queryZh: string): string {
  return createHash("sha256").update(queryZh.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase(), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Перевод запроса (Polza)

export function factoryTranslatorFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): TranslateSetup {
  return chinaTranslatorFromEnv(env, fetchImpl, { prompt: FACTORY_QUERY_PROMPT });
}

export interface TranslateQueryResult {
  queryZh: string | null;
  /** Перевод есть, но длиннее FACTORY_QUERY_MAX — отдаётся для правки (оплачен — не выбрасываем), искать по нему нельзя, пока не сократят. */
  draftZh: string | null;
  /** Почему перевода нет — одной строкой (человек пишет по-китайски сам). */
  reason: string | null;
  costUsd: number;
}

const WRITE_ZH = "напишите запрос по-китайски";

/**
 * Перевод запроса на китайский. Потолок движка проверяется до платного вызова (без учёта расхода — не платим вовсе); расход пишется в
 * статью cn_translate. Перевод не получился — причина словами, а не пустой запрос.
 */
export async function translateFactoryQuery(
  db: SupabaseClient, queryRu: string, deps: { translator?: TranslateSetup; env?: Record<string, string | undefined>; clock?: () => number } = {},
): Promise<TranslateQueryResult> {
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? Date.now;
  const text = queryRu.replace(/\s+/g, " ").trim();
  const none = (reason: string): TranslateQueryResult => ({ queryZh: null, draftZh: null, reason, costUsd: 0 });
  if (!text || text.length > FACTORY_QUERY_RU_MAX) return none(`запрос по-русски — от 1 до ${FACTORY_QUERY_RU_MAX} знаков`);
  const setup = deps.translator ?? factoryTranslatorFromEnv(env);
  if (!setup.translate || !setup.price) return none(`${setup.reason ?? "перевод не подключён"} — ${WRITE_ZH}`);
  let week;
  try {
    week = await loadEngineWeekForSpend(db, clock(), { attempts: 2, delayMs: 300 });
  } catch {
    return none(`учёт расхода не прочитался — перевод отложен, ${WRITE_ZH}`);
  }
  if (!week) return none(`нет учёта расхода движка — перевод не запускается, ${WRITE_ZH}`);
  const refusal = engineRefusal(week, FACTORY_TRANSLATE_KIND, translateBatchMaxUsd([text], setup.price, FACTORY_QUERY_PROMPT), engineBudgetConfig(env));
  if (refusal) return none(`${refusal} — ${WRITE_ZH}`);
  let result;
  try {
    result = await setup.translate([text]);
  } catch (error) {
    await addEngineUsage(db, clock(), FACTORY_TRANSLATE_KIND, { calls: 0, failed: 1, costUsd: 0 });
    const why = isTranslateStop(error) ? error.message : "перевод не удался";
    return none(`${why} — ${WRITE_ZH}`);
  }
  await addEngineUsage(db, clock(), FACTORY_TRANSLATE_KIND, { calls: 1, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd });
  const queryZh = normalizeQueryZh(result.texts[0]);
  if (queryZh) return { queryZh, draftZh: null, reason: null, costUsd: result.costUsd };
  // Перевод с иероглифами, но длиннее 60 знаков — оплачен: отдаём для правки, а не выбрасываем.
  const draft = typeof result.texts[0] === "string" ? result.texts[0].normalize("NFKC").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, FACTORY_QUERY_RU_MAX) : "";
  if (draft && HAN_RE.test(draft)) {
    return { queryZh: null, draftZh: draft, reason: `перевод длиннее ${FACTORY_QUERY_MAX} знаков (${draft.length}) — сократите его в поле по-китайски`, costUsd: result.costUsd };
  }
  return { queryZh: null, draftZh: null, reason: `перевод не получился — ${WRITE_ZH}`, costUsd: result.costUsd };
}

// ---------------------------------------------------------------------------
// Учёт и потолок запросов

/** Запросов раздела к 1688 за московские сутки; null — таблицы учёта нет (тогда не ищем: лимит нечем считать). */
export async function factoryCallsToday(db: SupabaseClient, nowMs: number): Promise<number | null> {
  const { data, error } = await db.from(USAGE).select("calls").eq("day", moscowToday(nowMs)).eq("kind", FACTORY_USAGE_KIND).maybeSingle();
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  return Number((data as { calls?: number | string } | null)?.calls ?? 0) || 0;
}

export const NO_USAGE_WORDS = "нет учёта запросов (assortment_ai_usage) — лимит запросов 1688 нечем считать, поиск не запускается";

/** Помещаются ли `need` запросов в дневной потолок; нет — причина словами. */
export function factoryCapRefusal(callsToday: number | null, need: number, cap = FACTORY_DAILY_CALLS): string | null {
  if (callsToday == null) return NO_USAGE_WORDS;
  if (callsToday + need > cap) return `дневной потолок запросов 1688 к фабрикам выбран: ${callsToday} из ${cap} — повторите завтра`;
  return null;
}

export type CallReservation = { ok: true; callsToday: number } | { ok: false; callsToday: number | null; reason: string };

/**
 * Забронировать `need` запросов к 1688 в учёте ДО обращения: прочитать дневную строку, проверить потолок и прибавить сравнением-и-заменой
 * (по calls и updated_at). Параллельный поиск, успевший между чтением и записью, сбивает замену — бронь перечитывается и проверяется
 * заново, так что два поиска при 58 из 60 не сделают четыре запроса. Бронь не возвращается: неудачный запрос — тоже запрос. Нет таблицы
 * учёта — отказ (лимит нечем считать).
 */
export async function reserveFactoryCalls(db: SupabaseClient, nowMs: number, need: number, cap = FACTORY_DAILY_CALLS): Promise<CallReservation> {
  const day = moscowToday(nowMs);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await db.from(USAGE).select("calls,updated_at").eq("day", day).eq("kind", FACTORY_USAGE_KIND).maybeSingle();
    if (error) {
      if (missing(error)) return { ok: false, callsToday: null, reason: NO_USAGE_WORDS };
      throw new Error(error.message);
    }
    const row = data as { calls?: number | string | null; updated_at?: string | null } | null;
    const prev = Number(row?.calls ?? 0) || 0;
    const refusal = factoryCapRefusal(prev, need, cap);
    if (refusal) return { ok: false, callsToday: prev, reason: refusal };
    // Новое время — строго позже прежнего: иначе писатель с той же миллисекундой (addEngineUsage) не заметил бы брони.
    const prevMs = Date.parse(String(row?.updated_at ?? ""));
    const stamp = new Date(Math.max(Date.now(), Number.isFinite(prevMs) ? prevMs + 1 : 0)).toISOString();
    if (!row) {
      const { error: insertError } = await db.from(USAGE).insert({
        day, kind: FACTORY_USAGE_KIND, calls: need, failed_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, updated_at: stamp,
      });
      if (!insertError) return { ok: true, callsToday: need };
      if (missing(insertError)) return { ok: false, callsToday: null, reason: NO_USAGE_WORDS };
      if ((insertError as { code?: string }).code !== "23505") throw new Error(insertError.message);
      continue; // строку успел создать другой поиск — перечитаем
    }
    const { data: updated, error: updateError } = await db.from(USAGE).update({ calls: prev + need, updated_at: stamp })
      .eq("day", day).eq("kind", FACTORY_USAGE_KIND).eq("calls", row.calls).eq("updated_at", row.updated_at).select("day");
    if (updateError) throw new Error(updateError.message);
    if (updated && (updated as unknown[]).length > 0) return { ok: true, callsToday: prev + need };
  }
  throw new Error("учёт запросов 1688 не записался: строку постоянно обновляет другой поиск — повторите");
}

/** Неудачные запросы (уже забронированные) — в failed_calls той же строки; сбой учёта — заметкой, а не отказом. */
async function countFailed(db: SupabaseClient, nowMs: number, failed: number, notes: string[]): Promise<void> {
  if (failed <= 0) return;
  try {
    await addEngineUsage(db, nowMs, FACTORY_USAGE_KIND, { calls: 0, failed, costUsd: 0 });
  } catch {
    if (!notes.includes("учёт запроса 1688 не записался")) notes.push("учёт запроса 1688 не записался");
  }
}

// ---------------------------------------------------------------------------
// Поиск

export interface FactorySourceState {
  status: FactorySourceStatus;
  reason: string | null;
  /** Сколько пришло (фабрик / карточек товаров); null — источник не ответил. */
  count: number | null;
}

/** Что кладётся в кэш: разобранная выдача без имён ИП, legal_name и контактов. */
export interface FactorySearchPayload {
  queryZh: string;
  queryRu: string | null;
  cluster: FactoryClusterKey | null;
  sources: { suppliers: FactorySourceState; products: FactorySourceState };
  factories: FactoryCard[];
  sellers: FactoryCard[];
}

export type FactorySearchRefusal = "no_key" | "bad_query" | "no_usage" | "daily_cap" | "failed";

export interface FactorySearchResponse extends FactorySearchPayload {
  ok: boolean;
  refused: FactorySearchRefusal | null;
  reason: string | null;
  /** Строка кэша — по ней «В шорт-лист» берёт снимок с сервера; null — кэша нет (миграция не применена или запись не удалась). */
  searchId: string | null;
  fromCache: boolean;
  cacheAvailable: boolean;
  createdAt: string | null;
  expiresAt: string | null;
  /** Запросов к 1688 в этом поиске (из кэша — 0). */
  calls: number;
  callsToday: number | null;
  dailyCap: number;
  notes: string[];
}

export interface FactoryDeps {
  env?: Record<string, string | undefined>;
  callers?: FactoryCallers;
  clock?: () => number;
  dailyCap?: number;
}

const emptyState = (status: FactorySourceStatus = "error", reason: string | null = null): FactorySourceState => ({ status, reason, count: null });

function emptyResponse(queryZh: string, queryRu: string | null, cluster: FactoryClusterKey | null, dailyCap: number): FactorySearchResponse {
  return {
    ok: false, refused: null, reason: null, searchId: null, fromCache: false, cacheAvailable: false, createdAt: null, expiresAt: null, calls: 0, callsToday: null, dailyCap,
    queryZh, queryRu, cluster, sources: { suppliers: emptyState(), products: emptyState() }, factories: [], sellers: [], notes: [],
  };
}

/** Строка кэша похожа на выдачу (а не на мусор или прошлую форму). */
function payloadOf(value: unknown): FactorySearchPayload | null {
  if (!isRecord(value) || !Array.isArray(value.factories) || !Array.isArray(value.sellers) || !isRecord(value.sources)) return null;
  return value as unknown as FactorySearchPayload;
}

interface CacheRow {
  id: string;
  result: unknown;
  created_at: string;
  expires_at: string;
}

async function readCache(db: SupabaseClient, key: string, nowIso: string): Promise<{ available: boolean; row: CacheRow | null }> {
  const { data, error } = await db.from(FACTORY_SEARCH_TABLE).select("id,result,created_at,expires_at").eq("query_key", key).gt("expires_at", nowIso)
    .order("created_at", { ascending: false }).limit(1);
  if (error) {
    if (missing(error)) return { available: false, row: null };
    throw new Error(`${FACTORY_SEARCH_TABLE}: ${error.message}`);
  }
  const row = ((data ?? []) as CacheRow[])[0] ?? null;
  return { available: true, row: row && payloadOf(row.result) ? row : null };
}

/**
 * Кэшировать (под ключом запроса, на 7 дней) можно только полную выдачу: оба источника ответили. «Навык недоступен» (в том числе 401 —
 * подпись не принята) — не ответ: владелец выдаст право — и повтор должен сразу спросить 1688, а не неделю отвечать «недоступен» из кэша;
 * лимит и сбой — тем более.
 */
export function cacheable(sources: FactorySearchPayload["sources"]): boolean {
  return [sources.suppliers, sources.products].every((s) => s.status === "ok");
}

/**
 * Поиск фабрик по китайскому запросу (уже переведённому и поправленному человеком). Порядок: ключ → запрос → кэш (свежий — ответ без
 * запросов к 1688) → учёт и дневной потолок (два запроса должны поместиться целиком) → два запроса разом → сведение источников → кэш.
 * Источник, который не ответил, — состояние словами; второй показывается (поиск поставщиков недоступен — остаются продавцы из выдачи
 * товаров). Оба не ответили — поиск не состоялся, в кэш ничего не пишется.
 */
export async function runFactorySearch(
  db: SupabaseClient,
  input: { queryZh: string; queryRu?: string | null; cluster?: FactoryClusterKey | null; who: string },
  deps: FactoryDeps = {},
): Promise<FactorySearchResponse> {
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? Date.now;
  const dailyCap = deps.dailyCap ?? FACTORY_DAILY_CALLS;
  const cluster = input.cluster ?? null;
  const queryRu = input.queryRu ? input.queryRu.replace(/\s+/g, " ").trim().slice(0, FACTORY_QUERY_RU_MAX) || null : null;
  const base = normalizeQueryZh(input.queryZh);
  const out = emptyResponse(base ?? String(input.queryZh ?? "").slice(0, FACTORY_QUERY_MAX), queryRu, cluster, dailyCap);
  if (!chinaKeyConfigured(env)) return { ...out, refused: "no_key", reason: CHINA_STOP_WORDS.no_key };
  if (!base) return { ...out, refused: "bad_query", reason: `запрос для 1688 — на китайском, до ${FACTORY_QUERY_MAX} знаков` };
  const queryZh = composeQuery(base, cluster);
  out.queryZh = queryZh;
  const nowMs = clock();
  const nowIso = new Date(nowMs).toISOString();
  const key = factoryQueryKey(queryZh);

  // Сырые выдачи старше 7 дней стираются в начале каждого поиска — и при попадании в кэш, и при отказе, а не только после новой записи.
  await purgeExpiredSearches(db, nowMs);
  const cache = await readCache(db, key, nowIso);
  out.cacheAvailable = cache.available;
  if (!cache.available) out.notes.push(`кэш поиска не создан — нужна миграция ${FACTORY_MIGRATION}; шорт-листа тоже нет`);
  if (cache.row) {
    const cached = payloadOf(cache.row.result) as FactorySearchPayload;
    return {
      ...out, ...cached, ok: true, searchId: cache.row.id, fromCache: true, createdAt: cache.row.created_at, expiresAt: cache.row.expires_at,
      callsToday: await factoryCallsToday(db, nowMs).catch(() => null), notes: [...out.notes, FACTORY_UNVERIFIED_NOTE],
    };
  }

  const booked = await reserveFactoryCalls(db, nowMs, FACTORY_CALLS_PER_SEARCH, dailyCap);
  out.callsToday = booked.callsToday;
  if (!booked.ok) return { ...out, refused: booked.callsToday == null ? "no_usage" : "daily_cap", reason: booked.reason };

  const callers = deps.callers ?? makeFactoryCallers({ env });
  const [suppliersRes, productsRes] = await Promise.allSettled([callers.suppliers(queryZh), callers.products(queryZh)]);
  out.calls = FACTORY_CALLS_PER_SEARCH;
  await countFailed(db, clock(), [suppliersRes, productsRes].filter((r) => r.status === "rejected").length, out.notes);

  let suppliers: SupplierFactory[] = [];
  let offers: FactoryOffer[] = [];
  if (suppliersRes.status === "fulfilled") {
    suppliers = parseSourceSuppliers(suppliersRes.value);
    out.sources.suppliers = { status: "ok", reason: suppliers.length ? null : "1688 не нашёл фабрик по этому запросу", count: suppliers.length };
  } else out.sources.suppliers = emptyState(...stateOf(suppliersRes.reason));
  if (productsRes.status === "fulfilled") {
    offers = parseFactoryProducts(productsRes.value);
    out.sources.products = { status: "ok", reason: offers.length ? null : "1688 не нашёл товаров по этому запросу", count: offers.length };
  } else out.sources.products = emptyState(...stateOf(productsRes.reason));

  if (suppliersRes.status === "rejected" && productsRes.status === "rejected") {
    const a = out.sources.suppliers.reason;
    const b = out.sources.products.reason;
    return { ...out, refused: "failed", reason: a === b ? a : `поиск поставщиков: ${a}; поиск товаров: ${b}` };
  }

  const built = buildFactoryResult(suppliers, offers, { sellerKey: factorySellerKey(env) });
  out.factories = built.factories;
  out.sellers = built.sellers;
  out.ok = true;
  out.notes.push(FACTORY_UNVERIFIED_NOTE);

  if (cache.available) {
    const payload: FactorySearchPayload = { queryZh, queryRu, cluster, sources: out.sources, factories: out.factories, sellers: out.sellers };
    const id = randomUUID();
    const expiresAt = new Date(nowMs + FACTORY_CACHE_DAYS * DAY_MS).toISOString();
    // Неполная выдача (источник недоступен ключу, упёрся в лимит или сбой) пишется под ключом, который поиск не найдёт: «В шорт-лист» по ней
    // работает, а повтор запроса снова спросит 1688, а не отдаст неделю неполную выдачу.
    const complete = cacheable(out.sources);
    if (!complete) out.notes.push("выдача неполная — в кэш повторов не кладём: повтор запроса снова спросит 1688");
    const { error } = await db.from(FACTORY_SEARCH_TABLE).insert({
      id, direction: "bags", query_key: complete ? key : factoryQueryKey(`partial:${id}`), query_zh: queryZh, query_ru: queryRu, cluster_key: cluster, result: payload, calls: out.calls,
      created_by: input.who.slice(0, 200), created_at: nowIso, expires_at: expiresAt,
    });
    if (error) out.notes.push("кэш поиска не записался — «В шорт-лист» недоступен для этой выдачи, повторите поиск");
    else {
      out.searchId = id;
      out.createdAt = nowIso;
      out.expiresAt = expiresAt;
    }
  }
  return out;
}

function stateOf(error: unknown): [FactorySourceStatus, string] {
  const s = factoryErrorState(error);
  return [s.status, s.reason];
}

// ---------------------------------------------------------------------------
// Проверка компании (88查): поиск по названию → риски по коду (каждый шаг — своей кнопкой, по запросу на шаг)

export type CheckRefusal = "no_key" | "bad_input" | "not_company" | "unverified" | "no_usage" | "daily_cap" | "failed";

/**
 * Кандидат 88查 с подписью сервера: token = «время выдачи.HMAC» по коду и фактам реестра (статус, дата, тип, капитал, район). На шаге
 * «риски» сервер принимает факты только с действующей подписью — «Р — реестр КНР» не пишется со слов клиента, а код привязан к
 * кандидату, которого 88查 показал. У ИП и кандидатов без кода подписи нет (риски по ним не проверяем).
 */
export type CheckedCandidate = CompanyCandidate & { token: string | null };

export interface CompanySearchResponse {
  ok: boolean;
  refused: CheckRefusal | null;
  reason: string | null;
  /** Кандидаты: у юрлиц — название и код; у ИП — только регион, статус и тип (тёзок сверяет человек). */
  candidates: CheckedCandidate[];
  total: number | null;
  /** Кандидат, чьё название совпало с запросом целиком (после нормализации); null — точного совпадения нет. */
  exactIndex: number | null;
  calls: number;
  callsToday: number | null;
  dailyCap: number;
}

export interface CompanyRiskResponse {
  ok: boolean;
  refused: CheckRefusal | null;
  reason: string | null;
  facts: RegistryFacts | null;
  /** В какую запись шорт-листа сохранено; null — не сохраняли (фабрики нет в шорт-листе или нет миграции). */
  savedTo: string | null;
  notes: string[];
  calls: number;
  callsToday: number | null;
  dailyCap: number;
}

/** Название для 88查: иероглифы, до 120 знаков, юрлицо по суффиксу (у ИП название не храним и в реестре не ищем). */
export function companyNameInput(value: unknown): { name: string | null; reason: string | null; notCompany: boolean } {
  if (typeof value !== "string") return { name: null, reason: "нет названия компании", notCompany: false };
  const name = value.normalize("NFKC").replace(/<[^>]*>/g, "").replace(/\s+/g, "").trim();
  if (!name || name.length > 120 || !HAN_RE.test(name)) return { name: null, reason: "название компании — по-китайски, до 120 знаков", notCompany: false };
  if (entityFromName(name) !== "company") return { name: null, reason: "проверка в реестре — только для юрлиц (…有限公司): у ИП название не храним", notCompany: true };
  return { name, reason: null, notCompany: false };
}

export const CREDIT_CODE_RE = /^[0-9A-Z]{18}$/;

/** Сколько живёт выбор кандидата: дольше — «нажмите «Проверить компанию» ещё раз» (старая вкладка не пишет устаревший статус). */
export const CANDIDATE_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Подписываемые факты кандидата — строки как их отдал разбор (или null), в постоянном порядке. */
const SIGNED_FIELDS = ["status", "establishedOn", "entType", "regCapText", "area"] as const;

function candidateMac(secret: Buffer, code: string, fields: Record<string, unknown>, issuedAt: number): string {
  const payload = JSON.stringify([code, issuedAt, ...SIGNED_FIELDS.map((f) => (typeof fields[f] === "string" ? fields[f] : null))]);
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

/** Подпись кандидата юрлица с кодом; у ИП и без кода — null. */
export function signCandidate(candidate: CompanyCandidate, env: Record<string, string | undefined>, nowMs: number): string | null {
  if (candidate.entity !== "company" || !candidate.creditCode) return null;
  const secret = factorySecret(env, "cha88-candidate");
  if (!secret) return null;
  const issuedAt = Math.floor(nowMs);
  return `${issuedAt}.${candidateMac(secret, candidate.creditCode, candidate as unknown as Record<string, unknown>, issuedAt)}`;
}

/** Подпись кандидата верна, относится к этому коду и не старше CANDIDATE_TOKEN_TTL_MS. */
export function verifyCandidate(value: unknown, code: string, env: Record<string, string | undefined>, nowMs: number): boolean {
  if (!isRecord(value) || typeof value.token !== "string") return false;
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{20,100})$/.exec(value.token);
  if (!m) return false;
  const issuedAt = Number(m[1]);
  if (!(issuedAt <= nowMs + 60_000 && nowMs - issuedAt <= CANDIDATE_TOKEN_TTL_MS)) return false;
  const secret = factorySecret(env, "cha88-candidate");
  if (!secret) return false;
  const expected = Buffer.from(candidateMac(secret, code, value, issuedAt), "utf8");
  const got = Buffer.from(m[2], "utf8");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function runCompanySearch(db: SupabaseClient, input: { name: unknown; who: string }, deps: FactoryDeps = {}): Promise<CompanySearchResponse> {
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? Date.now;
  const dailyCap = deps.dailyCap ?? FACTORY_DAILY_CALLS;
  const out: CompanySearchResponse = { ok: false, refused: null, reason: null, candidates: [], total: null, exactIndex: null, calls: 0, callsToday: null, dailyCap };
  if (!chinaKeyConfigured(env)) return { ...out, refused: "no_key", reason: CHINA_STOP_WORDS.no_key };
  const { name, reason, notCompany } = companyNameInput(input.name);
  if (!name) return { ...out, refused: notCompany ? "not_company" : "bad_input", reason };
  const nowMs = clock();
  const booked = await reserveFactoryCalls(db, nowMs, 1, dailyCap);
  out.callsToday = booked.callsToday;
  if (!booked.ok) return { ...out, refused: booked.callsToday == null ? "no_usage" : "daily_cap", reason: booked.reason };
  const callers = deps.callers ?? makeFactoryCallers({ env });
  const notes: string[] = [];
  let data: Record<string, unknown>;
  try {
    data = await callers.companySearch(name);
  } catch (error) {
    await countFailed(db, clock(), 1, notes);
    return { ...out, calls: 1, refused: "failed", reason: factoryErrorState(error).reason };
  }
  const parsed = parseCompanySearch(data);
  const target = normalizeCompanyName(name);
  const exact = parsed.candidates.findIndex((c) => c.name != null && normalizeCompanyName(c.name) === target);
  const candidates: CheckedCandidate[] = parsed.candidates.map((c) => ({ ...c, token: signCandidate(c, env, nowMs) }));
  return {
    ...out, ok: true, calls: 1, candidates, total: parsed.total, exactIndex: exact >= 0 ? exact : null,
    reason: parsed.candidates.length ? null : "88查 не нашёл компанию с таким названием",
  };
}

const cleanRelay = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) || null : null);

/**
 * Кандидат из первого шага, которого человек выбрал (передаёт экран): статус, дата регистрации, тип, капитал, район — это факты, которые
 * сервер сам получил от 88查 и подписал (verifyCandidate проверяет подпись до этого разбора). Проверяется по форме; вид лица и «действует»
 * пересчитываются здесь, а не берутся с экрана. Имён тут нет и не принимается.
 */
export function candidateRelay(value: unknown): Partial<CompanyCandidate> | null {
  if (!isRecord(value)) return null;
  const status = cleanRelay(value.status, 20);
  const entType = cleanRelay(value.entType, 40);
  const established = typeof value.establishedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.establishedOn) ? value.establishedOn : null;
  return {
    status, active: statusActive(status), establishedOn: established, entType, entity: entityFromType(entType),
    regCapText: cleanRelay(value.regCapText, 60), area: cleanRelay(value.area, 60),
  };
}

export const UNVERIFIED_CANDIDATE_WORDS = "выбор компании не подтверждён 88查 или устарел (дольше часа) — нажмите «Проверить компанию» ещё раз";

export async function runCompanyRisk(
  db: SupabaseClient,
  input: { creditCode: unknown; factoryId?: string | null; candidate?: unknown; who: string },
  deps: FactoryDeps = {},
): Promise<CompanyRiskResponse> {
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? Date.now;
  const dailyCap = deps.dailyCap ?? FACTORY_DAILY_CALLS;
  const notes: string[] = [];
  const out: CompanyRiskResponse = { ok: false, refused: null, reason: null, facts: null, savedTo: null, notes, calls: 0, callsToday: null, dailyCap };
  if (!chinaKeyConfigured(env)) return { ...out, refused: "no_key", reason: CHINA_STOP_WORDS.no_key };
  const code = typeof input.creditCode === "string" ? input.creditCode.trim().toUpperCase() : "";
  if (!CREDIT_CODE_RE.test(code)) return { ...out, refused: "bad_input", reason: "единый кредитный код — 18 знаков (цифры и латиница)" };
  const nowMs = clock();
  const candidate = candidateRelay(input.candidate);
  if (candidate?.entity === "individual") return { ...out, refused: "not_company", reason: "это ИП (个体工商户): по решению владельца код и название ИП не храним — проверка вручную" };
  // Факты с меткой «Р» — только те, что сервер сам получил от 88查 на первом шаге и подписал; код — того же кандидата.
  if (!verifyCandidate(input.candidate, code, env, nowMs)) return { ...out, refused: "unverified", reason: UNVERIFIED_CANDIDATE_WORDS };
  const booked = await reserveFactoryCalls(db, nowMs, 1, dailyCap);
  out.callsToday = booked.callsToday;
  if (!booked.ok) return { ...out, refused: booked.callsToday == null ? "no_usage" : "daily_cap", reason: booked.reason };
  const callers = deps.callers ?? makeFactoryCallers({ env });
  let data: Record<string, unknown>;
  try {
    data = await callers.companyRisk(code);
  } catch (error) {
    await countFailed(db, clock(), 1, notes);
    return { ...out, calls: 1, refused: "failed", reason: factoryErrorState(error).reason };
  }
  const facts = registryFacts(candidate, parseCompanyRisk(data), moscowToday(nowMs));
  let savedTo: string | null = null;
  if (input.factoryId) {
    const saved = await saveRegistryCheck(db, { id: input.factoryId, facts, creditCode: code, who: input.who, nowMs: clock(), sellerKey: factorySellerKey(env) });
    if (saved.saved) savedTo = input.factoryId;
    else if (saved.reason) notes.push(saved.reason);
  }
  return { ...out, ok: true, calls: 1, facts, savedTo };
}
