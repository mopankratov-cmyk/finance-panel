import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { moscowToday } from "@/lib/sync/moscowDay";
import { CHINA_STOP_WORDS, chinaKeyConfigured } from "./china1688";
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
import { FACTORY_MIGRATION, FACTORY_SEARCH_TABLE, saveRegistryCheck } from "./factoryShortlist";

export { FACTORY_MIGRATION, FACTORY_SEARCH_TABLE };

/**
 * «Фабрики сумок (1688)»: поиск фабрик по кнопке, перевод запроса, кэш на 7 дней, проверка компании в 88查, учёт и потолки запросов.
 *
 * Поиск: запрос по-русски → перевод на китайский дешёвым ИИ (тот же перевод Polza, что у трендов: статья cn_translate, общий потолок
 * движка; без Polza человек пишет по-китайски сам) → китайский текст виден и правится → чип кластера дописывается к запросу → два запроса
 * к 1688 разом: поиск поставщиков (source_suppliers) и поиск товаров (find.product, по продажам, 40). Повтор того же запроса за 7 дней —
 * из кэша, без запросов к 1688. Запросы к 1688 стоят 0 $, но считаются (assortment_ai_usage, статья cn_1688_factory): на поиск — не больше
 * двух, на проверку компании — двух (поиск по названию и риски по коду, каждый по своей кнопке), в сутки — FACTORY_DAILY_CALLS; потолок
 * проверяется до запроса. Без ключа 1688 — ни одного запроса (и вкладки нет); без миграции — поиск без кэша.
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
  "Переводи коротко, словами китайских продавцов: вид сумки, материал, заметная деталь.",
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
  if (!text || text.length > FACTORY_QUERY_RU_MAX) return { queryZh: null, reason: `запрос по-русски — от 1 до ${FACTORY_QUERY_RU_MAX} знаков`, costUsd: 0 };
  const setup = deps.translator ?? factoryTranslatorFromEnv(env);
  if (!setup.translate || !setup.price) return { queryZh: null, reason: `${setup.reason ?? "перевод не подключён"} — ${WRITE_ZH}`, costUsd: 0 };
  let week;
  try {
    week = await loadEngineWeekForSpend(db, clock(), { attempts: 2, delayMs: 300 });
  } catch {
    return { queryZh: null, reason: `учёт расхода не прочитался — перевод отложен, ${WRITE_ZH}`, costUsd: 0 };
  }
  if (!week) return { queryZh: null, reason: `нет учёта расхода движка — перевод не запускается, ${WRITE_ZH}`, costUsd: 0 };
  const refusal = engineRefusal(week, FACTORY_TRANSLATE_KIND, translateBatchMaxUsd([text], setup.price, FACTORY_QUERY_PROMPT), engineBudgetConfig(env));
  if (refusal) return { queryZh: null, reason: `${refusal} — ${WRITE_ZH}`, costUsd: 0 };
  let result;
  try {
    result = await setup.translate([text]);
  } catch (error) {
    await addEngineUsage(db, clock(), FACTORY_TRANSLATE_KIND, { calls: 0, failed: 1, costUsd: 0 });
    const why = isTranslateStop(error) ? error.message : "перевод не удался";
    return { queryZh: null, reason: `${why} — ${WRITE_ZH}`, costUsd: 0 };
  }
  await addEngineUsage(db, clock(), FACTORY_TRANSLATE_KIND, { calls: 1, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd });
  const queryZh = normalizeQueryZh(result.texts[0]);
  return { queryZh, reason: queryZh ? null : `перевод не получился — ${WRITE_ZH}`, costUsd: result.costUsd };
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

async function countCall(db: SupabaseClient, nowMs: number, ok: boolean, notes: string[]): Promise<void> {
  try {
    await addEngineUsage(db, nowMs, FACTORY_USAGE_KIND, ok ? { calls: 1, costUsd: 0 } : { calls: 1, failed: 1, costUsd: 0 });
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

/** Кэшировать можно, если ни один источник не упёрся в лимит или временный сбой («навык недоступен» — ответ, его можно помнить). */
export function cacheable(sources: FactorySearchPayload["sources"]): boolean {
  return [sources.suppliers, sources.products].every((s) => s.status === "ok" || s.status === "unavailable");
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

  const callsToday = await factoryCallsToday(db, nowMs);
  out.callsToday = callsToday;
  const refusal = factoryCapRefusal(callsToday, FACTORY_CALLS_PER_SEARCH, dailyCap);
  if (refusal || callsToday == null) return { ...out, refused: callsToday == null ? "no_usage" : "daily_cap", reason: refusal ?? NO_USAGE_WORDS };

  const callers = deps.callers ?? makeFactoryCallers({ env });
  const [suppliersRes, productsRes] = await Promise.allSettled([callers.suppliers(queryZh), callers.products(queryZh)]);
  out.calls = FACTORY_CALLS_PER_SEARCH;
  await countCall(db, clock(), suppliersRes.status === "fulfilled", out.notes);
  await countCall(db, clock(), productsRes.status === "fulfilled", out.notes);
  out.callsToday = callsToday + FACTORY_CALLS_PER_SEARCH;

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

  const built = buildFactoryResult(suppliers, offers);
  out.factories = built.factories;
  out.sellers = built.sellers;
  out.ok = true;
  out.notes.push(FACTORY_UNVERIFIED_NOTE);

  if (cache.available) {
    const payload: FactorySearchPayload = { queryZh, queryRu, cluster, sources: out.sources, factories: out.factories, sellers: out.sellers };
    const id = randomUUID();
    const expiresAt = new Date(nowMs + FACTORY_CACHE_DAYS * DAY_MS).toISOString();
    // Неполная выдача (источник упёрся в лимит или сбой) пишется под ключом, который поиск не найдёт: «В шорт-лист» по ней работает,
    // а повтор запроса снова спросит 1688, а не отдаст неделю неполную выдачу.
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
      // Старше 7 дней — стираются (сырые выдачи дольше не храним).
      await db.from(FACTORY_SEARCH_TABLE).delete().lt("expires_at", nowIso).then(() => undefined, () => undefined);
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

export type CheckRefusal = "no_key" | "bad_input" | "not_company" | "no_usage" | "daily_cap" | "failed";

export interface CompanySearchResponse {
  ok: boolean;
  refused: CheckRefusal | null;
  reason: string | null;
  /** Кандидаты: у юрлиц — название и код; у ИП — только регион, статус и тип (тёзок сверяет человек). */
  candidates: CompanyCandidate[];
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

export async function runCompanySearch(db: SupabaseClient, input: { name: unknown; who: string }, deps: FactoryDeps = {}): Promise<CompanySearchResponse> {
  const env = deps.env ?? process.env;
  const clock = deps.clock ?? Date.now;
  const dailyCap = deps.dailyCap ?? FACTORY_DAILY_CALLS;
  const out: CompanySearchResponse = { ok: false, refused: null, reason: null, candidates: [], total: null, exactIndex: null, calls: 0, callsToday: null, dailyCap };
  if (!chinaKeyConfigured(env)) return { ...out, refused: "no_key", reason: CHINA_STOP_WORDS.no_key };
  const { name, reason, notCompany } = companyNameInput(input.name);
  if (!name) return { ...out, refused: notCompany ? "not_company" : "bad_input", reason };
  const nowMs = clock();
  const callsToday = await factoryCallsToday(db, nowMs);
  out.callsToday = callsToday;
  const refusal = factoryCapRefusal(callsToday, 1, dailyCap);
  if (refusal) return { ...out, refused: callsToday == null ? "no_usage" : "daily_cap", reason: refusal };
  const callers = deps.callers ?? makeFactoryCallers({ env });
  const notes: string[] = [];
  let data: Record<string, unknown>;
  try {
    data = await callers.companySearch(name);
  } catch (error) {
    await countCall(db, clock(), false, notes);
    return { ...out, calls: 1, callsToday: (callsToday ?? 0) + 1, refused: "failed", reason: factoryErrorState(error).reason };
  }
  await countCall(db, clock(), true, notes);
  const parsed = parseCompanySearch(data);
  const target = normalizeCompanyName(name);
  const exact = parsed.candidates.findIndex((c) => c.name != null && normalizeCompanyName(c.name) === target);
  return {
    ...out, ok: true, calls: 1, callsToday: (callsToday ?? 0) + 1, candidates: parsed.candidates, total: parsed.total, exactIndex: exact >= 0 ? exact : null,
    reason: parsed.candidates.length ? null : "88查 не нашёл компанию с таким названием",
  };
}

const cleanRelay = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max) || null : null);

/**
 * Кандидат из первого шага, которого человек выбрал (передаёт экран): статус, дата регистрации, тип, капитал, район. Проверяется по форме;
 * вид лица и «действует» пересчитываются здесь, а не берутся с экрана. Имён тут нет и не принимается.
 */
export function candidateRelay(value: unknown): Partial<CompanyCandidate> | null {
  if (!isRecord(value)) return null;
  const status = cleanRelay(value.status, 20);
  const entType = cleanRelay(value.entType, 40);
  const established = typeof value.establishedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.establishedOn) ? value.establishedOn : null;
  return {
    status, active: statusActive(status), establishedOn: established, entType, entity: entityFromType(entType),
    regCapText: cleanRelay(value.regCapText, 40), area: cleanRelay(value.area, 40),
  };
}

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
  const candidate = candidateRelay(input.candidate);
  if (candidate?.entity === "individual") return { ...out, refused: "not_company", reason: "это ИП (个体工商户): по решению владельца код и название ИП не храним — проверка вручную" };
  const nowMs = clock();
  const callsToday = await factoryCallsToday(db, nowMs);
  out.callsToday = callsToday;
  const refusal = factoryCapRefusal(callsToday, 1, dailyCap);
  if (refusal) return { ...out, refused: callsToday == null ? "no_usage" : "daily_cap", reason: refusal };
  const callers = deps.callers ?? makeFactoryCallers({ env });
  let data: Record<string, unknown>;
  try {
    data = await callers.companyRisk(code);
  } catch (error) {
    await countCall(db, clock(), false, notes);
    return { ...out, calls: 1, callsToday: (callsToday ?? 0) + 1, refused: "failed", reason: factoryErrorState(error).reason };
  }
  await countCall(db, clock(), true, notes);
  const facts = registryFacts(candidate, parseCompanyRisk(data), moscowToday(nowMs));
  let savedTo: string | null = null;
  if (input.factoryId) {
    const saved = await saveRegistryCheck(db, { id: input.factoryId, facts, creditCode: code, who: input.who, nowMs: clock() });
    if (saved.saved) savedTo = input.factoryId;
    else if (saved.reason) notes.push(saved.reason);
  }
  return { ...out, ok: true, calls: 1, callsToday: (callsToday ?? 0) + 1, facts, savedTo };
}
