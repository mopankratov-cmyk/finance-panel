import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowToday, shiftIsoDay } from "@/lib/sync/moscowDay";
import { rowsByIds } from "./byIds";
import { catalogAiConfig, costUsd, polzaKey, POLZA_PRICES_RUB } from "./catalogAi";
import {
  CHINA_NICHES, CHINA_NICHES_VERSION, CHINA_STOP_WORDS, chinaKeyConfigured, countRefCopies, FIND_PRODUCT_PATH, isChina1688Error, isNewOffer, nicheSearchBody,
  nicheTop, OPPORTUNITY_BODY, parseFindProduct, parseOfferHot, parseOpportunities, parseRefKey, refSearchBody, stripChinaMoney, trendBody, WORKFLOW_PATH,
  CALL_TIMEOUT_MS, RETRY_DELAY_MS, TRANSIENT_RETRIES,
  type BrandRef, type ChinaCaller, type ChinaHost, type ChinaNiche, type MarketTrend,
} from "./china1688";
import type { AssortmentDirection } from "./constants";
import { ENGINE_KIND, engineBudgetConfig, engineRefusal } from "./engineBudget";
import { addEngineUsage, loadEngineWeekForSpend } from "./engineBudgetStore";
import { isMissingAssortmentSchema } from "./errors";

/**
 * «Китай (1688)»: недельный снимок (крон /api/sync/assortment-china). Неделя — с понедельника по Москве; все строки снимка получают
 * observed_on = понедельник, даже если доделаны во вторник. Крон ежедневный, но работает только пока снимок недели не завершён:
 * в понедельник начинается новый, недоделанное (упёрлись во время, в лимит 1688, во временный сбой) доделывают следующие прогоны.
 *
 * Что снимается: топ каждой ниши CHINA_NICHES (find.product, по продажам, до 40 карточек), копии по номерам Zara/Uniqlo из рилсов
 * «Залетает» за 30 дней (один поиск на номер), тренд ключа каждой ниши (offer_hot) и «возможности» (offer_opportunity) по нашим
 * категориям. Названия топа переводятся на русский дешёвым ИИ (Polza, статья учёта cn_translate, общий потолок движка Ф2); без ключа
 * Polza — остаётся китайское название.
 *
 * Запросы к 1688 стоят 0 $, но считаются (assortment_ai_usage, kind cn_1688): потолки на прогон и на 7 суток проверяются до запроса.
 * 429 / Qos* — прогон откладывается без траты попытки задачи (и следующие прогоны ждут RATE_LIMIT_PAUSE_MS); ключ не принят — остановка
 * одной причиной с хостом (gateway — блок на экране скрыт; ainext — не снимаются только тренды). Без миграции 202610070001, без ключа
 * ALI_1688_AK и без строки S104 (в ней хранится прогресс недели) прогон не начинается — причина одной строкой.
 */

export const CHINA_MIGRATION = "202610070001_assortment_china_1688.sql";
export const CHINA_SOURCE_ID = "S104";
export const CHINA_JOB = "assortment-china";
export const CHINA_USAGE_KIND = ENGINE_KIND.cn1688;
export const CHINA_TRANSLATE_KIND = ENGINE_KIND.cnTranslate;

const OFFERS = "assortment_cn_offer_snapshot";
const ARTICLES = "assortment_cn_article_snapshot";
const TRENDS = "assortment_cn_trend_snapshot";
const USAGE = "assortment_ai_usage";
const SOURCES = "assortment_sources";
const POSTS = "assortment_social_post";
const LOCK_KIND = `lock:${CHINA_USAGE_KIND}`;
/** Замок держится дольше maxDuration (300 с): два прогона разом не идут. */
const LEASE_MS = 6 * 60 * 1000;
const RELEASED = "1970-01-01T00:00:00.000Z";
const DAY_MS = 24 * 3600 * 1000;

/** После 429 / Qos* следующие прогоны ждут столько (документация навыков советует 1–2 минуты, у нас — с запасом). */
export const RATE_LIMIT_PAUSE_MS = 2 * 3600 * 1000;
/** Попыток задачи (временный сбой, ошибка параметров или сервиса) — потом задача недели закрывается как неудавшаяся. */
export const MAX_TASK_ATTEMPTS = 3;
/** Номера из рилсов за столько дней. */
export const REFS_WINDOW_DAYS = 30;
/** Худший случай одного вызова: таймаут × (1 + повтор) + пауза повтора. Позже дедлайна минус это — новых вызовов не начинаем. */
export const CALL_WORST_MS = CALL_TIMEOUT_MS * (1 + TRANSIENT_RETRIES) + RETRY_DELAY_MS;
/** Перевод — пачка названий за вызов; на прогон не больше столько названий. */
export const TRANSLATE_BATCH = 40;
export const TRANSLATE_PER_RUN = 160;
/** Вызовов перевода за неделю снимка (≈60 новых названий — 2 вызова; потолок с запасом). */
export const TRANSLATE_CALLS_PER_WEEK = 12;
/** Запас времени на вызов перевода (таймаут Polza): позже дедлайна минус это перевод не начинается — оборванный платформой платный вызов
 * не записал бы ни расход, ни недельный счётчик вызовов. */
export const TRANSLATE_TIMEOUT_MS = 55_000;
/** Предел ответа модели на одно название: перевод не длиннее 80 знаков — до ~30 токенов, с кавычками и запятой; запас вдвое с лишним. */
export const TRANSLATE_OUT_TOKENS_PER_TITLE = 80;
/** Служебная разметка чата (роли, обёртка) поверх байт вопроса и названий. */
const TRANSLATE_CHAT_OVERHEAD_TOKENS = 64;
export const DEFAULT_TRANSLATE_MODEL = "google/gemini-2.5-flash-lite";

// ---------------------------------------------------------------------------
// Настройки

export interface ChinaConfig {
  /** Выключатель: ASSORTMENT_CHINA=off. */
  enabled: boolean;
  /** Вызовов 1688 за прогон (ASSORTMENT_CHINA_MAX_CALLS_PER_RUN, по умолчанию 40). */
  maxCallsPerRun: number;
  /** Вызовов 1688 за 7 суток (ASSORTMENT_CHINA_WEEKLY_CALLS, по умолчанию 150; снимок ≈ 21 + 21 + номера + 1). */
  weeklyCalls: number;
  /** Номеров из рилсов в неделю (ASSORTMENT_CHINA_REFS_PER_WEEK, по умолчанию 20). */
  refsPerWeek: number;
  /** Карточек в топе ниши (до 40 — столько отдаёт один вызов). */
  topPerNiche: number;
  /** Пауза между вызовами 1688, мс (проба: ≥3 с — ни одного 429). */
  pauseMs: number;
}

function nonNegative(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function chinaConfig(env: Record<string, string | undefined> = process.env): ChinaConfig {
  return {
    enabled: (env.ASSORTMENT_CHINA ?? "").trim().toLowerCase() !== "off",
    maxCallsPerRun: nonNegative(env.ASSORTMENT_CHINA_MAX_CALLS_PER_RUN, 40),
    weeklyCalls: nonNegative(env.ASSORTMENT_CHINA_WEEKLY_CALLS, 150),
    refsPerWeek: nonNegative(env.ASSORTMENT_CHINA_REFS_PER_WEEK, 20),
    topPerNiche: Math.min(40, Math.max(1, nonNegative(env.ASSORTMENT_CHINA_TOP_PER_NICHE, 40))),
    pauseMs: 3000,
  };
}

/** Понедельник московской недели (ГГГГ-ММ-ДД) — observed_on всех строк снимка этой недели. */
export function chinaWeekOf(nowMs: number): string {
  const today = moscowToday(nowMs);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return shiftIsoDay(today, -((dow + 6) % 7));
}

// ---------------------------------------------------------------------------
// Состояние недельного снимка — в capabilities источника S104 (1688) под ключом china

export type ChinaTaskStatus = "done" | "empty" | "failed" | "pending";

export interface ChinaTaskMark {
  status: ChinaTaskStatus;
  attempts: number;
  at: string;
  note?: string | null;
}

export interface ChinaStopMark {
  reason: "auth" | "rate_limit";
  at: string;
  message: string;
  host?: ChinaHost | null;
}

export interface ChinaState {
  week: string | null;
  version: string | null;
  marks: Record<string, ChinaTaskMark>;
  runs: number;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * Остановка одной причиной: ключ не принят или лимит 1688. Снимается первым удачным вызовом. host — на каком хосте: ключ, не принятый
   * только сервисом трендов (ainext), не прячет топ ниш и копии (поиск идёт через gateway); без host (старая запись) — как gateway.
   */
  stop: ChinaStopMark | null;
  lastRunAt: string | null;
  /** Вызовов перевода за неделю снимка: не больше TRANSLATE_CALLS_PER_WEEK (ответ-мусор не должен покупаться каждый прогон). */
  translateCalls: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const emptyChinaState = (): ChinaState => ({ week: null, version: null, marks: {}, runs: 0, startedAt: null, completedAt: null, stop: null, lastRunAt: null, translateCalls: 0 });

export function readChinaState(capabilities: unknown): ChinaState {
  const raw = isRecord(capabilities) && isRecord(capabilities.china) ? capabilities.china : null;
  if (!raw) return emptyChinaState();
  const marks: Record<string, ChinaTaskMark> = {};
  if (isRecord(raw.marks)) {
    for (const [id, m] of Object.entries(raw.marks)) {
      if (!isRecord(m) || !["done", "empty", "failed", "pending"].includes(String(m.status))) continue;
      marks[id] = { status: m.status as ChinaTaskStatus, attempts: Math.max(0, Math.floor(Number(m.attempts) || 0)), at: String(m.at ?? ""), note: typeof m.note === "string" ? m.note : null };
    }
  }
  const stop: ChinaStopMark | null = isRecord(raw.stop) && (raw.stop.reason === "auth" || raw.stop.reason === "rate_limit") && typeof raw.stop.at === "string"
    ? {
      reason: raw.stop.reason as "auth" | "rate_limit", at: raw.stop.at, message: String(raw.stop.message ?? CHINA_STOP_WORDS[raw.stop.reason as "auth" | "rate_limit"]),
      host: raw.stop.host === "gateway" || raw.stop.host === "ainext" ? raw.stop.host : null,
    }
    : null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    week: str(raw.week), version: str(raw.version), marks, runs: Math.max(0, Math.floor(Number(raw.runs) || 0)),
    startedAt: str(raw.startedAt), completedAt: str(raw.completedAt), stop, lastRunAt: str(raw.lastRunAt),
    translateCalls: Math.max(0, Math.floor(Number(raw.translateCalls) || 0)),
  };
}

/**
 * Ключ отвергнут поиском 1688 (gateway): топ ниш и копии не снимаются — блок на экране скрыт. Отказ только сервиса трендов (ainext) — нет:
 * снимок топа и копий идёт и показывается, не снимаются тренды и «возможности».
 */
export function chinaKeyRejected(stop: ChinaStopMark | null | undefined): boolean {
  return stop?.reason === "auth" && stop.host !== "ainext";
}

/** Ключ не принят только сервисом трендов (ainext). */
export function chinaTrendsKeyRejected(stop: ChinaStopMark | null | undefined): boolean {
  return stop?.reason === "auth" && stop.host === "ainext";
}

/** Без строки S104: прогресс недели негде хранить — прогон не начинается. */
export const CHINA_NO_STATE_WORDS = "нет строки S104 (1688) в assortment_sources — прогресс недельного снимка негде хранить, прогон не начинается (засев — миграция 202610010005)";

/** Причина одной строкой: ключ не принят сервисом трендов (ainext), поиск работает. */
export const CHINA_TRENDS_AUTH_WORDS = "тренды и «возможности» 1688 не снимаются: ключ не принят сервисом трендов (ainext, 401) — топ ниш и копии снимаются";

function missing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error ?? "");
  return code === "42P01" || code === "PGRST205" || isMissingAssortmentSchema(new Error(message));
}

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

/** Состояние из S104; null — таблицы источников или строки S104 нет (тогда прогресс видно только по строкам снимка). */
export async function loadChinaState(db: SupabaseClient): Promise<{ capabilities: Record<string, unknown>; state: ChinaState } | null> {
  const { data, error } = await db.from(SOURCES).select("capabilities").eq("source_id", CHINA_SOURCE_ID).maybeSingle();
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const caps = (data as { capabilities?: unknown }).capabilities;
  const capabilities = isRecord(caps) ? { ...caps } : {};
  return { capabilities, state: readChinaState(capabilities) };
}

async function saveChinaState(db: SupabaseClient, capabilities: Record<string, unknown>, state: ChinaState): Promise<void> {
  const { error } = await db.from(SOURCES).update({ capabilities: { ...capabilities, china: state } }).eq("source_id", CHINA_SOURCE_ID);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Учёт запросов и замок прогона (в assortment_ai_usage, как у рилсов)

/** Вызовов 1688 за 7 московских суток; null — таблицы учёта нет (тогда и не начинаем: лимиты нечем считать). */
export async function loadChinaWeekCalls(db: SupabaseClient, nowMs: number): Promise<number | null> {
  const since = shiftIsoDay(moscowToday(nowMs), -6);
  const { data, error } = await db.from(USAGE).select("day,calls").eq("kind", CHINA_USAGE_KIND).gte("day", since);
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  return ((data ?? []) as Array<{ calls: number | string }>).reduce((sum, r) => sum + (Number(r.calls) || 0), 0);
}

async function acquireLease(db: SupabaseClient, nowMs: number): Promise<string | null> {
  const day = moscowToday(nowMs);
  const stamp = new Date(nowMs).toISOString();
  const { data: before, error: beforeError } = await db.from(USAGE).select("updated_at").eq("day", shiftIsoDay(day, -1)).eq("kind", LOCK_KIND).maybeSingle();
  if (beforeError) throw new Error(beforeError.message);
  if (before && nowMs - Date.parse(String((before as { updated_at: string }).updated_at)) < LEASE_MS) return null;
  const { data, error } = await db.from(USAGE).select("updated_at").eq("day", day).eq("kind", LOCK_KIND).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    const { error: insertError } = await db.from(USAGE).insert({ day, kind: LOCK_KIND, updated_at: stamp });
    if (!insertError) return stamp;
    if ((insertError as { code?: string }).code === "23505") return null;
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
    // Не снялся — истечёт сам через LEASE_MS.
  }
}

// ---------------------------------------------------------------------------
// Номера товаров из рилсов

export interface RefTask {
  ref: BrandRef;
  direction: AssortmentDirection | null;
  /** 0 — «сильный залёт», 1 — «залетает», 2 — остальные рилсы. */
  priority: number;
  likes: number;
}

interface PostRefRow {
  refs: unknown;
  brand: string | null;
  direction: string | null;
  verdict: string | null;
  likes: number | string | null;
  match_status: string | null;
  match_gender: string | null;
  hidden_at: string | null;
}

/**
 * Номера товаров из рилсов за окно: только Zara и Uniqlo, только женское (не мужское и не детское по привязке), не скрытые; сначала
 * «сильный залёт», потом «залетает», потом остальные (по лайкам), не больше `limit`.
 */
export function pickRefTasks(posts: readonly PostRefRow[], limit: number): RefTask[] {
  const best = new Map<string, RefTask>();
  for (const post of posts) {
    if (post.hidden_at) continue;
    if (post.match_status === "men" || post.match_status === "kids" || post.match_gender === "men" || post.match_gender === "kids") continue;
    const priority = post.verdict === "strong" ? 0 : post.verdict === "viral" ? 1 : 2;
    const likes = Number(post.likes) || 0;
    const direction = post.direction === "jackets" || post.direction === "bags" ? post.direction : null;
    for (const raw of Array.isArray(post.refs) ? post.refs : []) {
      const ref = parseRefKey(String(raw));
      if (!ref) continue;
      const prev = best.get(ref.key);
      if (!prev || priority < prev.priority || (priority === prev.priority && likes > prev.likes)) {
        best.set(ref.key, { ref, direction: direction ?? prev?.direction ?? null, priority, likes });
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => a.priority - b.priority || b.likes - a.likes || a.ref.key.localeCompare(b.ref.key))
    .slice(0, Math.max(0, limit));
}

/** Номера из рилсов за окно; таблицы рилсов нет — пусто (номера не снимаем, остальное идёт). */
export async function loadRefTasks(db: SupabaseClient, nowMs: number, limit: number): Promise<RefTask[]> {
  if (limit <= 0) return [];
  const since = new Date(nowMs - REFS_WINDOW_DAYS * DAY_MS).toISOString();
  try {
    const rows = await loadAllSupabasePages<PostRefRow>((from, to) => db.from(POSTS)
      .select("code,refs,brand,direction,verdict,likes,match_status,match_gender,hidden_at")
      .eq("platform", "instagram").gte("published_at", since).order("code", { ascending: true }).range(from, to) as unknown as Page<PostRefRow>, { label: "Номера из рилсов" });
    return pickRefTasks(rows, limit);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Задачи недели

export type ChinaPhase = "niches" | "articles" | "trends";

export type ChinaTask =
  | { id: string; phase: "niches"; kind: "niche"; niche: ChinaNiche }
  | { id: string; phase: "articles"; kind: "ref"; ref: RefTask }
  | { id: string; phase: "trends"; kind: "trend"; niche: ChinaNiche }
  | { id: string; phase: "trends"; kind: "opportunities" };

export const nicheTaskId = (key: string) => `niche:${key}`;
export const refTaskId = (key: string) => `ref:${key}`;
export const trendTaskId = (key: string) => `trend:${key}`;
export const OPPORTUNITIES_TASK_ID = "opportunities";
export const marketListKey = (nicheKey: string) => `market:${nicheKey}`;
export const opportunityListKey = (platform: string, section: string) => `opportunity:${platform}:${section}`;

/** Все задачи недели в порядке выполнения: ниши, номера, тренды ниш, «возможности». */
export function weekTasks(refs: readonly RefTask[]): ChinaTask[] {
  return [
    ...CHINA_NICHES.map((niche): ChinaTask => ({ id: nicheTaskId(niche.key), phase: "niches", kind: "niche", niche })),
    ...refs.map((ref): ChinaTask => ({ id: refTaskId(ref.ref.key), phase: "articles", kind: "ref", ref })),
    ...CHINA_NICHES.map((niche): ChinaTask => ({ id: trendTaskId(niche.key), phase: "trends", kind: "trend", niche })),
    { id: OPPORTUNITIES_TASK_ID, phase: "trends", kind: "opportunities" },
  ];
}

/** Что уже есть в снимке недели (по строкам — на случай, если состояние S104 не записалось). */
export interface WeekPresence {
  niches: Set<string>;
  refs: Set<string>;
  lists: Set<string>;
}

export async function loadWeekPresence(db: SupabaseClient, week: string): Promise<WeekPresence> {
  const read = async <Row>(table: string, column: string, label: string) => loadAllSupabasePages<Row>((from, to) => db.from(table).select(column)
    .eq("observed_on", week).order(column, { ascending: true }).range(from, to) as unknown as Page<Row>, { label });
  const [offers, articles, trends] = await Promise.all([
    read<{ niche_key: string }>(OFFERS, "niche_key", "Снимок 1688: ниши"),
    read<{ ref_key: string }>(ARTICLES, "ref_key", "Снимок 1688: номера"),
    read<{ list_key: string }>(TRENDS, "list_key", "Снимок 1688: тренды"),
  ]);
  return { niches: new Set(offers.map((r) => r.niche_key)), refs: new Set(articles.map((r) => r.ref_key)), lists: new Set(trends.map((r) => r.list_key)) };
}

/** Задача закрыта: есть строки в снимке недели или отметка «сделано / пусто / не удалось» в состоянии. */
export function taskClosed(task: ChinaTask, marks: Record<string, ChinaTaskMark>, presence: WeekPresence): boolean {
  const mark = marks[task.id];
  if (mark && mark.status !== "pending") return true;
  if (task.kind === "niche") return presence.niches.has(task.niche.key);
  if (task.kind === "ref") return presence.refs.has(task.ref.ref.key);
  if (task.kind === "trend") return presence.lists.has(marketListKey(task.niche.key));
  return [...presence.lists].some((k) => k.startsWith("opportunity:"));
}

// ---------------------------------------------------------------------------
// Строки снимка

export interface OfferRow {
  provider: string;
  niche_key: string;
  direction: AssortmentDirection;
  observed_on: string;
  rank: number;
  offer_id: string;
  title_zh: string;
  title_ru: string | null;
  image_url: string | null;
  category: string | null;
  sold_text: string | null;
  sold_min: number | null;
  orders_30d: number | null;
  sellers: number | null;
  is_new: boolean;
  tags: string[];
}

/** Ответ find.product ниши → строки топа: без платных размещений и мужского/детского, со значками (повторы карточки отсекает разбор). */
export function nicheRows(niche: ChinaNiche, week: string, data: unknown, topPerNiche: number, known: ReadonlyMap<string, string> = new Map()): OfferRow[] {
  const top = nicheTop(parseFindProduct(data), topPerNiche);
  const rows: OfferRow[] = [];
  for (const o of top.offers) {
    rows.push({
      provider: "1688",
      niche_key: niche.key,
      direction: niche.direction,
      observed_on: week,
      rank: o.position,
      offer_id: o.offerId,
      title_zh: o.titleZh,
      title_ru: known.get(o.offerId) ?? null,
      image_url: o.imageUrl,
      category: o.category,
      sold_text: o.soldText,
      sold_min: o.soldMin,
      orders_30d: o.orders30d,
      sellers: top.sellers,
      is_new: isNewOffer(o.offerId, week),
      tags: [...o.badges, ...o.traits.map((t) => `cpv:${t}`)],
    });
  }
  return rows;
}

/** Ряд тренда для value_text: только числа (без цен раздела хитов Taobao). */
export function marketValueText(t: MarketTrend): string {
  return JSON.stringify({
    buyers: t.buyersPerDay, supply: t.supplyPerDay, ratio: t.ratio, yoy: t.yoyPct,
    series: t.series.map((p) => [p.month, p.value]), taobaoItems: t.taobaoItems, top1: t.top1Pct, top3: t.top3Pct,
  });
}

/** Уже переведённые названия тех же карточек из прошлых снимков: перевод не покупается дважды. */
async function knownTranslations(db: SupabaseClient, offerIds: readonly string[]): Promise<Map<string, string>> {
  if (offerIds.length === 0) return new Map();
  const rows = await rowsByIds<{ offer_id: string; title_ru: string | null }>([...new Set(offerIds)], "Переводы 1688", (part, from, to) => db.from(OFFERS)
    .select("offer_id,title_ru,observed_on,niche_key").in("offer_id", part).not("title_ru", "is", null)
    .order("offer_id", { ascending: true }).order("observed_on", { ascending: true }).order("niche_key", { ascending: true }).range(from, to) as unknown as Page<{ offer_id: string; title_ru: string | null }>);
  const out = new Map<string, string>();
  for (const r of rows) if (r.title_ru) out.set(r.offer_id, r.title_ru);
  return out;
}

async function upsert(db: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 200), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Перевод названий (Polza)

export interface TranslateResult {
  texts: Array<string | null>;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export type ChinaTranslator = (texts: string[]) => Promise<TranslateResult>;

/** Остановка перевода (не прогона): ключ, деньги, лимит, модель. */
export class TranslateStopError extends Error {
  constructor(message: string, readonly code: "auth" | "billing" | "rate_limit" | "config") {
    super(message);
    this.name = "TranslateStopError";
  }
}

export function isTranslateStop(error: unknown): error is TranslateStopError {
  return error instanceof TranslateStopError || (error instanceof Error && error.name === "TranslateStopError");
}

export interface TranslateSetup {
  translate: ChinaTranslator | null;
  /** Почему перевода нет (одной строкой) — экран показывает китайские названия. */
  reason: string | null;
  model: string;
  /** Цена модели, $ за миллион токенов (рубли Polza по курсу). */
  price: { in: number; out: number } | null;
}

const POLZA_CHAT_URL = "https://polza.ai/api/v1/chat/completions";

const TRANSLATE_PROMPT = [
  "Ты переводишь названия товаров с китайского оптового сайта 1688 на русский для байера женской одежды и сумок.",
  "Переводи кратко и по смыслу: вид вещи, крой, материал, заметная деталь; не длиннее 80 знаков.",
  "Не пиши цены, названия магазинов и фабрик, имена людей и рекламные слова; номера товаров брендов (6–7 цифр) сохраняй.",
  "Ответ — только JSON-массив строк той же длины и в том же порядке, без пояснений.",
].join(" ");

/** Ответ модели → переводы: JSON-массив той же длины, каждое — без сумм, не длиннее 200 знаков; иначе — все null. */
export function parseTranslations(content: string, expected: number): Array<string | null> {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  const none = Array.from({ length: expected }, () => null);
  if (start < 0 || end <= start) return none;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== expected) return none;
    return parsed.map((t) => {
      if (typeof t !== "string") return null;
      const clean = stripChinaMoney(t).slice(0, 200).trim();
      return clean || null;
    });
  } catch {
    return none;
  }
}

/** Переводчик Polza (OpenAI-совместимый чат), если есть ключ Polza и цена модели; иначе — причина одной строкой. */
export function chinaTranslatorFromEnv(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): TranslateSetup {
  const model = env.ASSORTMENT_CHINA_TRANSLATE_MODEL?.trim() || DEFAULT_TRANSLATE_MODEL;
  const rubPerUsd = catalogAiConfig(env).rubPerUsd;
  const rub = POLZA_PRICES_RUB[model] ?? null;
  const price = rub ? { in: rub.in / rubPerUsd, out: rub.out / rubPerUsd } : null;
  if ((env.ASSORTMENT_CHINA_TRANSLATE ?? "").trim().toLowerCase() === "off") return { translate: null, reason: "перевод выключен (ASSORTMENT_CHINA_TRANSLATE=off)", model, price };
  const key = polzaKey(env);
  if (!key) return { translate: null, reason: "нет ключа Polza — названия на китайском", model, price };
  if (!price) return { translate: null, reason: `нет цены модели перевода ${model}`, model, price };
  const translate: ChinaTranslator = async (texts) => {
    const response = await fetchImpl(POLZA_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        ...(model.startsWith("google/") ? { reasoning: { effort: "none" } } : {}),
        max_tokens: translateMaxTokens(texts.length),
        messages: [{ role: "system", content: TRANSLATE_PROMPT }, { role: "user", content: JSON.stringify(texts) }],
      }),
      signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost_rub?: number | string; cost?: number | string };
      error?: { code?: string };
    } | null;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new TranslateStopError(`Polza: ключ не принят (${response.status})`, "auth");
      if (response.status === 402 || payload?.error?.code === "INSUFFICIENT_BALANCE") throw new TranslateStopError("Polza: на счёте нет средств", "billing");
      if (response.status === 429) throw new TranslateStopError("Polza: лимит запросов", "rate_limit");
      if (response.status === 404) throw new TranslateStopError(`Polza: модель ${model} недоступна`, "config");
      throw new Error(`Polza: ответ ${response.status}`);
    }
    const content = payload?.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    const inputTokens = Number(payload?.usage?.prompt_tokens) || 0;
    const outputTokens = Number(payload?.usage?.completion_tokens) || 0;
    const rubCost = Number(payload?.usage?.cost_rub ?? payload?.usage?.cost);
    const reported = payload?.usage && (payload.usage.cost_rub != null || payload.usage.cost != null) && Number.isFinite(rubCost) && rubCost >= 0;
    return {
      texts: parseTranslations(text, texts.length),
      inputTokens,
      outputTokens,
      costUsd: reported ? Math.round((rubCost / rubPerUsd) * 100_000) / 100_000 : costUsd({ inputTokens, outputTokens }, price),
    };
  };
  return { translate, reason: null, model, price };
}

/** Предел ответа модели (max_tokens запроса) на пачку из `count` названий: обёртка JSON-массива и TRANSLATE_OUT_TOKENS_PER_TITLE на название. */
export function translateMaxTokens(count: number): number {
  return 100 + TRANSLATE_OUT_TOKENS_PER_TITLE * Math.max(0, Math.floor(count));
}

/**
 * Цена пачки перевода СВЕРХУ — для проверки общего потолка движка до платного вызова. Вход — не больше байт UTF-8 вопроса и названий
 * (любой токен модели — хотя бы один байт; иероглиф — 3 байта) плюс служебная разметка чата; выход — ровно предел max_tokens, который
 * уходит в запрос. Округление — вверх, до 0,00001 $.
 */
export function translateBatchMaxUsd(texts: readonly string[], price: { in: number; out: number }): number {
  const inputTokens = TRANSLATE_CHAT_OVERHEAD_TOKENS + Buffer.byteLength(TRANSLATE_PROMPT, "utf8") + Buffer.byteLength(JSON.stringify(texts), "utf8");
  const usd = (inputTokens * price.in + translateMaxTokens(texts.length) * price.out) / 1_000_000;
  return Math.ceil(usd * 100_000 - 1e-9) / 100_000;
}

// ---------------------------------------------------------------------------
// Прогон

export interface RunChinaOptions {
  env?: Record<string, string | undefined>;
  config?: ChinaConfig;
  /** Вызов 1688; по умолчанию — настоящий клиент (передаёт роут). */
  call: ChinaCaller;
  translator?: TranslateSetup | null;
  phase?: ChinaPhase | null;
  dryRun?: boolean;
  /** Новых вызовов не начинаем позже deadlineMs − CALL_WORST_MS. */
  deadlineMs: number;
  /** Часы и пауза — подставляются тестами. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type ChinaStop = "auth" | "rate_limit" | "time" | "run_cap" | "week_cap";

export interface ChinaPhaseCount {
  total: number;
  closed: number;
  done: number;
  empty: number;
  failed: number;
}

export interface ChinaRunSummary {
  skipped: string | null;
  skippedBecause?: "off" | "no_key" | "no_migration" | "no_state" | "no_usage" | "busy" | "idle" | "rate_limit_pause";
  week: string;
  version: string;
  calls: number;
  failedCalls: number;
  weekCalls: number | null;
  /** Строк снимка записано в этом прогоне (карточки топа, номера, тренды). */
  rows: number;
  /** Задачи этого прогона: сделано, пусто, не удалось (попытка потрачена). */
  done: number;
  empty: number;
  failed: number;
  byPhase: Record<ChinaPhase, ChinaPhaseCount>;
  refs: string[];
  stoppedBy: ChinaStop | null;
  /** На каком хосте ключ не принят (только при stoppedBy = auth). */
  stopHost: ChinaHost | null;
  stopMessage: string | null;
  complete: boolean;
  translated: number;
  /** Вызовов перевода в этом прогоне (и неудачных). */
  translateCalls: number;
  translateCostUsd: number;
  translateSkipped: string | null;
  /** Ошибки задач этого прогона (без ключа и без продавцов) — для журнала. */
  errors: string[];
}

function emptySummary(week: string): ChinaRunSummary {
  const phase = (): ChinaPhaseCount => ({ total: 0, closed: 0, done: 0, empty: 0, failed: 0 });
  return {
    skipped: null, week, version: CHINA_NICHES_VERSION, calls: 0, failedCalls: 0, weekCalls: null, rows: 0, done: 0, empty: 0, failed: 0,
    byPhase: { niches: phase(), articles: phase(), trends: phase() }, refs: [], stoppedBy: null, stopHost: null, stopMessage: null, complete: false,
    translated: 0, translateCalls: 0, translateCostUsd: 0, translateSkipped: null, errors: [],
  };
}

function countPhases(summary: ChinaRunSummary, tasks: readonly ChinaTask[], marks: Record<string, ChinaTaskMark>, presence: WeekPresence): void {
  for (const phase of ["niches", "articles", "trends"] as const) summary.byPhase[phase] = { total: 0, closed: 0, done: 0, empty: 0, failed: 0 };
  for (const task of tasks) {
    const count = summary.byPhase[task.phase];
    count.total += 1;
    if (!taskClosed(task, marks, presence)) continue;
    count.closed += 1;
    const status = marks[task.id]?.status;
    if (status === "empty") count.empty += 1;
    else if (status === "failed") count.failed += 1;
    else count.done += 1;
  }
}

/**
 * Недельный снимок 1688. Порядок: ниши → номера → тренды и «возможности», затем перевод новых названий топа. Каждая задача — один
 * вызов; между вызовами пауза; до вызова — дедлайн, потолок прогона и недели. 429 / Qos* — стоп без траты попытки; ключ не принят — стоп
 * одной причиной; прочий сбой — попытка задачи (после MAX_TASK_ATTEMPTS задача недели закрывается как неудавшаяся).
 */
export async function runChinaSnapshot(db: SupabaseClient, options: RunChinaOptions): Promise<ChinaRunSummary> {
  const env = options.env ?? process.env;
  const config = options.config ?? chinaConfig(env);
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nowMs = clock();
  const week = chinaWeekOf(nowMs);
  const summary = emptySummary(week);

  if (!config.enabled) return { ...summary, skipped: "выключено настройкой ASSORTMENT_CHINA=off", skippedBecause: "off" };
  if (!chinaKeyConfigured(env)) return { ...summary, skipped: CHINA_STOP_WORDS.no_key, skippedBecause: "no_key" };

  // Миграция: без таблиц снимка — тихо выходим с причиной.
  {
    const { error } = await db.from(OFFERS).select("offer_id").limit(1);
    if (error) {
      if (missing(error)) return { ...summary, skipped: `таблицы «Китай (1688)» не созданы — нужна миграция ${CHINA_MIGRATION}`, skippedBecause: "no_migration" };
      throw new Error(error.message);
    }
  }

  // Прогресс недели (отметки «пусто / не удалось», попытки, пауза после лимита, вызовы перевода) живёт в строке S104: без неё каждый прогон
  // начинал бы неделю заново — перезапрашивал пустое и вечно падающее, не держал паузу после 429 и недельный предел перевода.
  const loaded = await loadChinaState(db);
  if (!loaded) return { ...summary, skipped: CHINA_NO_STATE_WORDS, skippedBecause: "no_state" };
  let state = loaded.state;
  if (state.stop?.reason === "rate_limit" && nowMs - Date.parse(state.stop.at) < RATE_LIMIT_PAUSE_MS) {
    const until = new Date(Date.parse(state.stop.at) + RATE_LIMIT_PAUSE_MS).toISOString().slice(11, 16);
    return { ...summary, skipped: `пауза после лимита 1688 до ${until} UTC`, skippedBecause: "rate_limit_pause" };
  }

  const weekCalls = await loadChinaWeekCalls(db, nowMs);
  summary.weekCalls = weekCalls;
  if (weekCalls == null) return { ...summary, skipped: "нет учёта запросов (assortment_ai_usage, миграция 202610050005) — лимиты 1688 нечем считать", skippedBecause: "no_usage" };

  if (state.week !== week) state = { ...state, week, version: CHINA_NICHES_VERSION, marks: {}, runs: 0, startedAt: new Date(nowMs).toISOString(), completedAt: null, translateCalls: 0 };

  const refs = await loadRefTasks(db, nowMs, config.refsPerWeek);
  summary.refs = refs.map((r) => r.ref.key);
  const allTasks = weekTasks(refs);
  const presence = await loadWeekPresence(db, week);
  const tasks = allTasks.filter((t) => !options.phase || t.phase === options.phase);
  const pending = tasks.filter((t) => !taskClosed(t, state.marks, presence));
  countPhases(summary, allTasks, state.marks, presence);

  const translator = options.translator === undefined ? null : options.translator;
  const translateRoom = state.translateCalls < TRANSLATE_CALLS_PER_WEEK;
  const untranslated = translator?.translate && translateRoom ? await loadUntranslated(db, week, TRANSLATE_PER_RUN) : [];

  if (options.dryRun) {
    return { ...summary, complete: allTasks.every((t) => taskClosed(t, state.marks, presence)), skipped: null, translateSkipped: translator?.reason ?? (translator ? null : "перевод не подключён") };
  }
  if (pending.length === 0 && untranslated.length === 0) {
    return { ...summary, complete: allTasks.every((t) => taskClosed(t, state.marks, presence)), skipped: "недельный снимок готов — работы нет", skippedBecause: "idle" };
  }

  const lease = await acquireLease(db, nowMs);
  if (!lease) return { ...summary, skipped: "прогон уже идёт", skippedBecause: "busy" };
  const marks = { ...state.marks };
  // Прогресс пишется после каждой задачи: прогон, оборванный платформой на maxDuration, не теряет отметок «пусто / не удалось / попытка».
  const persist = async (final = false) => {
    const next: ChinaState = {
      ...state, marks, translateCalls: state.translateCalls + summary.translateCalls,
      ...(final ? { runs: state.runs + 1, lastRunAt: new Date(nowMs).toISOString() } : {}),
    };
    await saveChinaState(db, loaded.capabilities, next);
  };
  try {
    let first = true;
    for (const task of pending) {
      if (clock() + CALL_WORST_MS > options.deadlineMs) {
        summary.stoppedBy = "time";
        break;
      }
      if (summary.calls >= config.maxCallsPerRun) {
        summary.stoppedBy = "run_cap";
        break;
      }
      if (weekCalls + summary.calls >= config.weeklyCalls) {
        summary.stoppedBy = "week_cap";
        break;
      }
      if (!first && config.pauseMs > 0) await sleep(config.pauseMs);
      first = false;
      const at = new Date(clock()).toISOString();
      summary.calls += 1;
      let payload: unknown;
      try {
        payload = await callFor(options.call, task);
      } catch (error) {
        summary.failedCalls += 1;
        await addEngineUsage(db, clock(), CHINA_USAGE_KIND, { calls: 1, failed: 1, costUsd: 0 });
        if (!isChina1688Error(error)) throw error;
        if (error.kind === "auth" || error.kind === "no_key") {
          // Хост — в отметке: ключ, не принятый только сервисом трендов, не прячет топ ниш и копии.
          const host = taskHost(task);
          summary.stoppedBy = "auth";
          summary.stopHost = host;
          summary.stopMessage = host === "ainext" ? CHINA_TRENDS_AUTH_WORDS : CHINA_STOP_WORDS.auth;
          state.stop = { reason: "auth", at, message: summary.stopMessage, host };
          break;
        }
        if (error.kind === "rate_limit") {
          // Без траты попытки задачи: задача остаётся в очереди недели.
          summary.stoppedBy = "rate_limit";
          summary.stopMessage = CHINA_STOP_WORDS.rate_limit;
          state.stop = { reason: "rate_limit", at, message: CHINA_STOP_WORDS.rate_limit, host: taskHost(task) };
          break;
        }
        const attempts = (marks[task.id]?.attempts ?? 0) + 1;
        const final = attempts >= MAX_TASK_ATTEMPTS;
        marks[task.id] = { status: final ? "failed" : "pending", attempts, at, note: error.message.slice(0, 160) };
        if (final) summary.failed += 1;
        summary.errors.push(`${task.id}: ${error.message}`.slice(0, 200));
        await persist();
        continue;
      }
      await addEngineUsage(db, clock(), CHINA_USAGE_KIND, { calls: 1, costUsd: 0 });
      state.stop = null;
      const written = await applyTask(db, task, payload, week, config);
      summary.rows += written;
      const status: ChinaTaskStatus = written > 0 ? "done" : "empty";
      marks[task.id] = { status, attempts: (marks[task.id]?.attempts ?? 0) + 1, at, note: null };
      if (status === "done") summary.done += 1;
      else summary.empty += 1;
      await persist();
    }

    // Перевод новых названий топа — после 1688 и только если осталось время. Ключ не принят поиском (gateway) — не переводим: блок на
    // экране скрыт, платить не за что. Отказ только сервиса трендов (ainext) — переводим: топ ниш показывается.
    if (translator && !(summary.stoppedBy === "auth" && summary.stopHost !== "ainext")) {
      if (!translator.translate) summary.translateSkipped = translator.reason;
      else if (!translateRoom) summary.translateSkipped = `перевод недели исчерпал ${TRANSLATE_CALLS_PER_WEEK} вызовов — остальные названия на китайском`;
      else await translateWeek(db, summary, translator, week, { clock, deadlineMs: options.deadlineMs, env, callsLeft: TRANSLATE_CALLS_PER_WEEK - state.translateCalls });
    }

    countPhases(summary, allTasks, marks, presence);
    summary.complete = allTasks.every((t) => taskClosed(t, marks, presence));
    if (summary.complete && !state.completedAt) state.completedAt = new Date(clock()).toISOString();
    await persist(true);
    return summary;
  } finally {
    await releaseLease(db, nowMs, lease);
  }
}

/** Хост задачи: поиск (ниши, номера) — gateway, тренды и «возможности» — ainext. */
export function taskHost(task: ChinaTask): ChinaHost {
  return task.kind === "niche" || task.kind === "ref" ? "gateway" : "ainext";
}

function callFor(call: ChinaCaller, task: ChinaTask): Promise<unknown> {
  switch (task.kind) {
    case "niche":
      return call("gateway", FIND_PRODUCT_PATH, nicheSearchBody(task.niche));
    case "ref":
      return call("gateway", FIND_PRODUCT_PATH, refSearchBody(task.ref.ref, task.ref.direction));
    case "trend":
      return call("ainext", WORKFLOW_PATH, trendBody(task.niche.trendKey));
    case "opportunities":
      return call("ainext", WORKFLOW_PATH, OPPORTUNITY_BODY);
  }
}

/** Запись результата задачи; ответ — сколько строк снимка записано (0 — задача «пусто»). */
async function applyTask(db: SupabaseClient, task: ChinaTask, payload: unknown, week: string, config: ChinaConfig): Promise<number> {
  if (task.kind === "niche") {
    const draft = nicheRows(task.niche, week, payload, config.topPerNiche);
    if (draft.length === 0) return 0;
    const known = await knownTranslations(db, draft.map((r) => r.offer_id));
    const rows = draft.map((r) => ({ ...r, title_ru: known.get(r.offer_id) ?? null }));
    await upsert(db, OFFERS, rows as unknown as Record<string, unknown>[], "niche_key,observed_on,offer_id");
    await clearOlderImages(db, task.niche.key, week);
    return rows.length;
  }
  if (task.kind === "ref") {
    const copies = countRefCopies(parseFindProduct(payload).offers, task.ref.ref);
    // Ноль копий — тоже наблюдение недели («копий не нашли»), строка пишется.
    await upsert(db, ARTICLES, [{
      ref_key: task.ref.ref.key, observed_on: week, direction: task.ref.direction, offers: copies.offers, sellers: copies.sellers, sample_offer_ids: copies.sampleOfferIds,
    }], "ref_key,observed_on");
    return 1;
  }
  const model = payload as { bizData?: unknown };
  if (task.kind === "trend") {
    const trend = parseOfferHot(model?.bizData);
    if (!trend) return 0;
    await upsert(db, TRENDS, [{
      provider: "1688", list_key: marketListKey(task.niche.key), observed_on: week, rank: 1, keyword_zh: task.niche.trendKey, keyword_ru: task.niche.ru,
      value_text: marketValueText(trend), direction: task.niche.direction,
    }], "list_key,observed_on,rank");
    return 1;
  }
  const topics = parseOpportunities(payload);
  const rows = new Map<string, Record<string, unknown>>();
  for (const t of topics) {
    const listKey = opportunityListKey(t.platform, t.section);
    const id = `${listKey}#${t.rank}`;
    if (rows.has(id)) continue;
    rows.set(id, {
      provider: "1688", list_key: listKey, observed_on: week, rank: Math.max(1, t.rank), keyword_zh: t.topic, keyword_ru: null,
      value_text: JSON.stringify({ count: t.count, isUp: t.isUp, words: t.words }), direction: t.direction,
    });
  }
  if (rows.size === 0) return 0;
  await upsert(db, TRENDS, [...rows.values()], "list_key,observed_on,rank");
  return rows.size;
}

/**
 * Адрес фото 1688 («…_!!<id>-0-cib.jpg») несёт числовой id загрузившего (у ИП — фактически человека): храним его только у снимка ниши,
 * который показывается на экране (последний). Записан снимок этой недели — у прошлых снимков ниши адрес стирается: по сохранённым строкам
 * не связать карточки одного продавца между неделями. Неделя к неделе сравнивает только номер карточки и позицию — фото там не нужно.
 */
async function clearOlderImages(db: SupabaseClient, nicheKey: string, week: string): Promise<void> {
  const { error } = await db.from(OFFERS).update({ image_url: null }).eq("niche_key", nicheKey).lt("observed_on", week).not("image_url", "is", null);
  if (error) throw new Error(`${OFFERS}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Перевод в прогоне

interface UntranslatedItem {
  table: "offer" | "topic";
  /** offer_id или list_key#rank. */
  id: string;
  text: string;
  rank: number;
}

async function loadUntranslated(db: SupabaseClient, week: string, limit: number): Promise<UntranslatedItem[]> {
  const offers = await loadAllSupabasePages<{ offer_id: string; title_zh: string; rank: number }>((from, to) => db.from(OFFERS)
    .select("niche_key,offer_id,title_zh,rank").eq("observed_on", week).is("title_ru", null)
    .order("niche_key", { ascending: true }).order("offer_id", { ascending: true }).range(from, to) as unknown as Page<{ offer_id: string; title_zh: string; rank: number }>, { label: "Названия 1688 без перевода" });
  const topics = await loadAllSupabasePages<{ list_key: string; rank: number; keyword_zh: string }>((from, to) => db.from(TRENDS)
    .select("list_key,rank,keyword_zh").eq("observed_on", week).is("keyword_ru", null)
    .order("list_key", { ascending: true }).order("rank", { ascending: true }).range(from, to) as unknown as Page<{ list_key: string; rank: number; keyword_zh: string }>, { label: "Темы 1688 без перевода" });
  const byOffer = new Map<string, UntranslatedItem>();
  for (const r of offers) {
    const prev = byOffer.get(r.offer_id);
    if (!prev || r.rank < prev.rank) byOffer.set(r.offer_id, { table: "offer", id: r.offer_id, text: r.title_zh, rank: Number(r.rank) || 999 });
  }
  const items = [
    ...[...byOffer.values()].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)),
    ...topics.map((t): UntranslatedItem => ({ table: "topic", id: `${t.list_key}#${t.rank}`, text: t.keyword_zh, rank: Number(t.rank) || 999 })),
  ];
  return items.slice(0, Math.max(0, limit));
}

async function translateWeek(
  db: SupabaseClient, summary: ChinaRunSummary, translator: TranslateSetup, week: string,
  ctx: { clock: () => number; deadlineMs: number; env: Record<string, string | undefined>; callsLeft: number },
): Promise<void> {
  const translate = translator.translate;
  if (!translate || !translator.price) return;
  const items = await loadUntranslated(db, week, TRANSLATE_PER_RUN);
  if (items.length === 0) return;
  const budget = engineBudgetConfig(ctx.env);
  for (let i = 0; i < items.length; i += TRANSLATE_BATCH) {
    if (summary.translateCalls >= ctx.callsLeft) {
      summary.translateSkipped = `перевод недели исчерпал ${TRANSLATE_CALLS_PER_WEEK} вызовов — остальные названия на китайском`;
      return;
    }
    if (ctx.clock() + TRANSLATE_TIMEOUT_MS > ctx.deadlineMs) {
      summary.translateSkipped = "не хватило времени прогона — переведём в следующем";
      return;
    }
    const batch = items.slice(i, i + TRANSLATE_BATCH);
    // Общий потолок движка — до вызова: без учёта (таблицы нет) не платим вовсе.
    let engineWeek;
    try {
      engineWeek = await loadEngineWeekForSpend(db, ctx.clock(), { attempts: 2, delayMs: 300 });
    } catch (error) {
      summary.translateSkipped = `учёт расхода не прочитался — перевод отложен (${error instanceof Error ? error.message : "ошибка"})`;
      return;
    }
    if (!engineWeek) {
      summary.translateSkipped = "нет учёта расхода движка — перевод не запускается";
      return;
    }
    const refusal = engineRefusal(engineWeek, CHINA_TRANSLATE_KIND, translateBatchMaxUsd(batch.map((b) => b.text), translator.price), budget);
    if (refusal) {
      summary.translateSkipped = refusal;
      return;
    }
    let result: TranslateResult;
    summary.translateCalls += 1;
    try {
      result = await translate(batch.map((b) => b.text));
    } catch (error) {
      await addEngineUsage(db, ctx.clock(), CHINA_TRANSLATE_KIND, { calls: 0, failed: 1, costUsd: 0 });
      summary.translateSkipped = isTranslateStop(error) ? error.message : `перевод не удался: ${error instanceof Error ? error.message : "ошибка"} — повторим в следующем прогоне`;
      return;
    }
    await addEngineUsage(db, ctx.clock(), CHINA_TRANSLATE_KIND, { calls: 1, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd });
    summary.translateCostUsd = Math.round((summary.translateCostUsd + result.costUsd) * 100_000) / 100_000;
    for (let k = 0; k < batch.length; k += 1) {
      const ru = result.texts[k];
      if (!ru) continue;
      const item = batch[k];
      if (item.table === "offer") {
        const { error } = await db.from(OFFERS).update({ title_ru: ru }).eq("offer_id", item.id).eq("observed_on", week);
        if (error) throw new Error(`${OFFERS}: ${error.message}`);
      } else {
        const [listKey, rank] = item.id.split("#");
        const { error } = await db.from(TRENDS).update({ keyword_ru: ru }).eq("list_key", listKey).eq("observed_on", week).eq("rank", Number(rank));
        if (error) throw new Error(`${TRENDS}: ${error.message}`);
      }
      summary.translated += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Журнал

/**
 * Строка журнала (sync_log): ключ не принят — error одной причиной; ни одна задача прогона не удалась — error; лимит 1688, неудачи при
 * сделанном, остановка по времени или потолку с хвостом — partial; остальное — ok.
 */
export function chinaRunLog(s: ChinaRunSummary): { status: "ok" | "partial" | "error"; note: string | null } {
  const phases = (["niches", "articles", "trends"] as const).map((p) => {
    const c = s.byPhase[p];
    const label = p === "niches" ? "ниши" : p === "articles" ? "номера" : "тренды";
    return `${label} ${c.closed}/${c.total}`;
  }).join(", ");
  const translate = s.translated > 0 ? `; перевод ${s.translated} назв. ($${s.translateCostUsd.toFixed(4)})` : s.translateSkipped ? `; перевод: ${s.translateSkipped}` : "";
  const base = `неделя ${s.week}: ${phases}; запросов 1688 ${s.calls}${s.failedCalls ? ` (сбоев ${s.failedCalls})` : ""}${translate}`;
  if (s.stoppedBy === "auth") return { status: "error", note: `${s.stopHost === "ainext" ? CHINA_TRENDS_AUTH_WORDS : CHINA_STOP_WORDS.auth}. ${base}` };
  const tried = s.done + s.empty + s.errors.length;
  if (tried > 0 && s.done + s.empty === 0) return { status: "error", note: `ни одна задача не удалась: ${s.errors.slice(0, 2).join("; ")}. ${base}` };
  if (s.stoppedBy === "rate_limit") return { status: "partial", note: `${CHINA_STOP_WORDS.rate_limit}. ${base}` };
  if (s.errors.length > 0) return { status: "partial", note: `${base}; сбои: ${s.errors.slice(0, 2).join("; ")}` };
  if (!s.complete && (s.stoppedBy === "time" || s.stoppedBy === "run_cap" || s.stoppedBy === "week_cap")) {
    const why = s.stoppedBy === "time" ? "время прогона" : s.stoppedBy === "run_cap" ? "потолок запросов прогона" : "потолок запросов недели";
    return { status: "partial", note: `упёрлись в ${why} — доделается следующими прогонами. ${base}` };
  }
  return { status: "ok", note: base };
}
