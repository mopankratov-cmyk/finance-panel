import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { moscowToday } from "@/lib/sync/moscowDay";
import { zaraModelCode } from "./brightdataCatalog";
import { googleSearchUrl, isUnlockerStop, type UnlockerFormat, type UnlockerResult } from "./brightdataUnlocker";
import { rowsByIds } from "./byIds";
import { thumbUrl } from "./catalog";
import type { AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema, isMissingColumnError } from "./errors";
import {
  acceptNeighborTopic, cleanHashtags, COMMENTS_MIN, COST_PER_REQUEST_USD, detectBrand, detectDirection, extractRefs, GOOGLE_QUERIES, googleQuery, HISTORY_LIMIT, intentShare,
  BASELINE_POSTS, looksMenswear, MAX_AGE_DAYS, measureDue, medianBaseline, MIN_AGE_MS, MIN_BASELINE_LIKE_POSTS, parseGoogleReels, parseProfilePage, parseReelPage,
  parseTopicPage, parseUniqloCard, parseZaraCard, passesPrefilter, postUrl, profileUrl, REELS_RULE_VERSION, sanitizeCaption, SEED_ACCOUNTS, SEED_TOPICS,
  shortcodeToDate, SOCIAL_PLATFORM, topicUrl, uniqloCardUrls, verdictV1, withinDiscoveryWindow, zaraCardUrl,
  type AccountKind, type BaselinePost, type CardGender, type GridPost, type ParsedProfile, type ParsedReel, type SeedTopic, type SocialBrand, type SocialConfig,
  type SocialVerdict,
} from "./socialReels";

export { SEED_ACCOUNTS, SEED_TOPICS } from "./socialReels";

/**
 * «Залетает в соцсетях»: база (аккаунты-источники и рилсы), прогон крона и чтение для ленты. Без миграции
 * 202610060011_assortment_social_reels.sql прогон и лента тихо выходят с причиной; без ключа Bright Data прогон не начинается.
 *
 * Прогон: (а) поиск — раз в 6+ дней темы /popular/ и Google, профили наблюдаемых аккаунтов — когда им пора (раз в 6 дней);
 * (б) замер постов 2–21 дня (первый, на 3-й и 7-й день), база автора — по его прошлым постам, вердикт reels-v1;
 * (в) привязка «залетевших» к модели: каталог Zara/Uniqlo по номеру, иначе карточка на сайте бренда.
 * Каждый запрос — в учёт `assortment_ai_usage` (kind brightdata_social), потолки на прогон и на неделю проверяются до запроса.
 */

export const SOCIAL_MIGRATION = "202610060011_assortment_social_reels.sql";
const ACCOUNTS = "assortment_social_account";
const POSTS = "assortment_social_post";
const USAGE = "assortment_ai_usage";
const SOURCES = "assortment_sources";
const SOURCE_ITEMS = "assortment_source_items";
const HEADS_VIEW = "assortment_catalog_heads";
export const SOCIAL_SOURCE_ID = "S068";
export const SOCIAL_USAGE_KIND = "brightdata_social";
const LOCK_KIND = `lock:${SOCIAL_USAGE_KIND}`;
const LEASE_MS = 6 * 60 * 1000;
const RELEASED = "1970-01-01T00:00:00.000Z";
const DAY_MS = 24 * 3600 * 1000;
/** Поиск по темам и Google — не чаще раза в 6 дней; профиль наблюдаемого аккаунта — тоже. */
export const DISCOVER_EVERY_DAYS = 6;
export const PROFILE_EVERY_DAYS = 6;
/** База автора свежая 7 дней — дальше пересчитываем. */
export const BASELINE_FRESH_DAYS = 7;
/** Авто-аккаунт становится наблюдаемым, если появился в выдаче ≥ 2 раз за 30 дней. */
export const WATCH_APPEARANCES = 2;
const APPEARANCE_DAYS = 30;
/** Новых соседних тем за поиск — не больше 10; всего авто-тем — не больше 40. */
export const NEW_TOPICS_PER_DISCOVER = 10;
const AUTO_TOPICS_MAX = 40;
/** Параллельных запросов к Bright Data — не больше четырёх. */
export const MAX_PARALLEL = 4;
/** Привязку «не нашли» / «есть у бренда» перепроверяем раз в неделю: модель могла появиться в каталоге. */
const MATCH_RECHECK_DAYS = 7;
/** Номеров одного рилса проверяем на сайте бренда не больше двух (подборка из шести вещей — не одна модель). */
const BRAND_SITE_REFS = 2;
/** Тема мёртвая после стольких пустых ответов подряд с распознанной вёрсткой; мёртвую перепроверяем раз в 4 недели. */
export const TOPIC_DEAD_MISSES = 3;
export const DEAD_TOPIC_RECHECK_DAYS = 28;
/** Поиск не дошёл до конца столько прогонов подряд — прогон «ошибка» (сторож скажет): потолок прогона мал или Instagram сбоит. */
export const DISCOVER_STALL_RUNS = 3;
/** Доля страниц рилсов без распознанного блока счётчиков, от которой прогон — «ошибка» (вёрстка Instagram изменилась). */
const LAYOUT_ALARM_MIN = 3;

export type MatchStatus = "catalog" | "brand_site" | "men" | "kids" | "not_found" | "no_ref" | "pending";
type AccountStatus = "watched" | "seen" | "excluded";
type AccountOrigin = "seed" | "auto" | "owner";

export interface HistoryPoint {
  at: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
  /** Отметка: в этот момент рилс впервые «залетел» (вердикт сменился на «залетает» / «сильный»). По ней сводка выбирает неделю. */
  verdict?: "strong" | "viral";
}

export interface AccountRow {
  platform: string;
  handle: string;
  kind: AccountKind;
  origin: AccountOrigin;
  status: AccountStatus;
  note: string | null;
  followers: number | null;
  likes_median: number | null;
  comments_median: number | null;
  baseline_posts: number | null;
  baseline_at: string | null;
  appearances: number;
  first_seen_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
}

export interface PostRow {
  platform: string;
  code: string;
  url: string;
  account_handle: string | null;
  published_at: string | null;
  first_seen_at: string;
  last_checked_at: string | null;
  checks: number;
  found_via: string[];
  topics: string[];
  brand: SocialBrand | null;
  direction: AssortmentDirection | null;
  caption_excerpt: string | null;
  hashtags: string[];
  refs: string[];
  likes: number | null;
  comments: number | null;
  views: number | null;
  likes_hidden: boolean | null;
  intent_count: number | null;
  intent_total: number | null;
  likes_ratio: number | null;
  comments_ratio: number | null;
  verdict: SocialVerdict | null;
  verdict_preliminary: boolean;
  rule_version: string | null;
  history: HistoryPoint[];
  match_status: MatchStatus | null;
  match_model_key: string | null;
  match_url: string | null;
  match_title: string | null;
  match_image: string | null;
  match_gender: CardGender | null;
  match_checked_at: string | null;
  last_error: string | null;
  /** Ручное «не интересно» — только читаем, прогон эту колонку не пишет. */
  hidden_at?: string | null;
}

const ACCOUNT_COLUMNS = "platform,handle,kind,origin,status,note,followers,likes_median,comments_median,baseline_posts,baseline_at,appearances,first_seen_at,last_checked_at,last_error";
const POST_MACHINE_COLUMNS = [
  "platform", "code", "url", "account_handle", "published_at", "first_seen_at", "last_checked_at", "checks", "found_via", "topics", "brand", "direction",
  "caption_excerpt", "hashtags", "refs", "likes", "comments", "views", "likes_hidden", "intent_count", "intent_total", "likes_ratio", "comments_ratio", "verdict",
  "verdict_preliminary", "rule_version", "history", "match_status", "match_model_key", "match_url", "match_title", "match_image", "match_gender",
  "match_checked_at", "last_error",
] as const;
const POST_COLUMNS = `${POST_MACHINE_COLUMNS.join(",")},hidden_at`;

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

function missing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error ?? "");
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205" || isMissingAssortmentSchema(new Error(message));
}

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (value: string | null | undefined) => (value ? Date.parse(value) : NaN);
const arr = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];
const num = (value: unknown): number | null => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

function normalizeAccount(row: Record<string, unknown>): AccountRow {
  return {
    platform: String(row.platform ?? SOCIAL_PLATFORM),
    handle: String(row.handle ?? ""),
    kind: (row.kind as AccountKind) ?? "unknown",
    origin: (row.origin as AccountOrigin) ?? "auto",
    status: (row.status as AccountStatus) ?? "seen",
    note: (row.note as string | null) ?? null,
    followers: num(row.followers),
    likes_median: num(row.likes_median),
    comments_median: num(row.comments_median),
    baseline_posts: num(row.baseline_posts),
    baseline_at: (row.baseline_at as string | null) ?? null,
    appearances: num(row.appearances) ?? 0,
    first_seen_at: (row.first_seen_at as string | null) ?? null,
    last_checked_at: (row.last_checked_at as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
  };
}

function normalizePost(row: Record<string, unknown>): PostRow {
  return {
    platform: String(row.platform ?? SOCIAL_PLATFORM),
    code: String(row.code ?? ""),
    url: String(row.url ?? ""),
    account_handle: (row.account_handle as string | null) ?? null,
    published_at: (row.published_at as string | null) ?? null,
    first_seen_at: String(row.first_seen_at ?? ""),
    last_checked_at: (row.last_checked_at as string | null) ?? null,
    checks: num(row.checks) ?? 0,
    found_via: arr(row.found_via),
    topics: arr(row.topics),
    brand: (row.brand as SocialBrand | null) ?? null,
    direction: (row.direction as AssortmentDirection | null) ?? null,
    caption_excerpt: (row.caption_excerpt as string | null) ?? null,
    hashtags: arr(row.hashtags),
    refs: arr(row.refs),
    likes: num(row.likes),
    comments: num(row.comments),
    views: num(row.views),
    likes_hidden: (row.likes_hidden as boolean | null) ?? null,
    intent_count: num(row.intent_count),
    intent_total: num(row.intent_total),
    likes_ratio: num(row.likes_ratio),
    comments_ratio: num(row.comments_ratio),
    verdict: (row.verdict as SocialVerdict | null) ?? null,
    verdict_preliminary: row.verdict_preliminary === true,
    rule_version: (row.rule_version as string | null) ?? null,
    history: Array.isArray(row.history) ? (row.history as HistoryPoint[]) : [],
    match_status: (row.match_status as MatchStatus | null) ?? null,
    match_model_key: (row.match_model_key as string | null) ?? null,
    match_url: (row.match_url as string | null) ?? null,
    match_title: (row.match_title as string | null) ?? null,
    match_image: (row.match_image as string | null) ?? null,
    match_gender: (row.match_gender as CardGender | null) ?? null,
    match_checked_at: (row.match_checked_at as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    hidden_at: (row.hidden_at as string | null) ?? null,
  };
}

/** Все аккаунты-источники (их десятки–сотни) — листанием, предел PostgREST 1 000 строк. */
export async function loadAccounts(db: SupabaseClient): Promise<Map<string, AccountRow>> {
  const rows = await loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from(ACCOUNTS).select(ACCOUNT_COLUMNS)
    .eq("platform", SOCIAL_PLATFORM).order("handle", { ascending: true }).range(from, to) as unknown as Page<Record<string, unknown>>, { label: "Аккаунты соцсетей" });
  return new Map(rows.map((r) => [String(r.handle), normalizeAccount(r)]));
}

/** Рилсы, опубликованные за окно (дни назад), — листанием по коду. */
export async function loadPosts(db: SupabaseClient, sinceMs: number): Promise<Map<string, PostRow>> {
  const rows = await loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from(POSTS).select(POST_COLUMNS)
    .eq("platform", SOCIAL_PLATFORM).gte("published_at", iso(sinceMs)).order("code", { ascending: true }).range(from, to) as unknown as Page<Record<string, unknown>>, { label: "Рилсы" });
  return new Map(rows.map((r) => [String(r.code), normalizePost(r)]));
}

// ---------------------------------------------------------------------------
// Учёт запросов и замок прогона (в assortment_ai_usage, как у признаков по фото)

/** Запросов за 7 московских дней; null — таблицы учёта нет (тогда и платить не начинаем). */
export async function loadWeekRequests(db: SupabaseClient, nowMs: number): Promise<number | null> {
  const today = moscowToday(nowMs);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
  const { data, error } = await db.from(USAGE).select("day,calls").eq("kind", SOCIAL_USAGE_KIND).gte("day", since);
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  return ((data ?? []) as Array<{ calls: number | string }>).reduce((sum, r) => sum + (Number(r.calls) || 0), 0);
}

/** Прибавить запросы к дневной строке учёта; сравнение-и-замена по updated_at — параллельный прогон не перетрёт. */
export async function addSocialUsage(db: SupabaseClient, nowMs: number, add: { calls: number; failed: number }): Promise<void> {
  if (add.calls <= 0 && add.failed <= 0) return;
  const day = moscowToday(nowMs);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await db.from(USAGE).select("calls,failed_calls,cost_usd,updated_at").eq("day", day).eq("kind", SOCIAL_USAGE_KIND).maybeSingle();
    if (error) throw new Error(error.message);
    const prev = (data ?? null) as { calls?: number; failed_calls?: number; cost_usd?: number | string; updated_at?: string } | null;
    const calls = Number(prev?.calls ?? 0) + add.calls;
    const next = {
      calls,
      failed_calls: Number(prev?.failed_calls ?? 0) + add.failed,
      cost_usd: Math.round(calls * COST_PER_REQUEST_USD * 100_000) / 100_000,
      updated_at: new Date().toISOString(),
    };
    if (!prev) {
      const { error: insertError } = await db.from(USAGE).insert({ day, kind: SOCIAL_USAGE_KIND, input_tokens: 0, output_tokens: 0, ...next });
      if (!insertError) return;
      if ((insertError as { code?: string }).code !== "23505") throw new Error(insertError.message);
      continue;
    }
    const { data: updated, error: updateError } = await db.from(USAGE).update(next).eq("day", day).eq("kind", SOCIAL_USAGE_KIND).eq("updated_at", prev.updated_at).select("day");
    if (updateError) throw new Error(updateError.message);
    if (updated && updated.length > 0) return;
  }
  throw new Error("учёт запросов не записался: строку постоянно обновляет другой прогон");
}

async function acquireLease(db: SupabaseClient, nowMs: number): Promise<string | null> {
  const day = moscowToday(nowMs);
  const stamp = iso(nowMs);
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
    // Не снялась — истечёт сама через LEASE_MS.
  }
}

// ---------------------------------------------------------------------------
// Состояние поиска — в capabilities источника S068 (Instagram Reels) под ключом social

/** Незавершённый поиск: что уже пройдено и сколько прогонов подряд он не дошёл до конца. Следующий прогон продолжает с места. */
export interface DiscoverProgress {
  startedAt: string;
  topics: string[];
  google: string[];
  runs: number;
  /** Соседние темы, найденные в этом поиске: в список тем идут, когда поиск дойдёт до конца (иначе он бы не кончался). */
  newTopics: SeedTopic[];
  /** Тем с рилсами в этом поиске (за все его прогоны): ни одной — разбор сломан или стена входа, поиск не засчитываем. */
  withReels: number;
}

export interface SocialState {
  discoveredAt: string | null;
  autoTopics: SeedTopic[];
  /** Мёртвые темы: slug → когда признали (после TOPIC_DEAD_MISSES пустых ответов подряд); раз в 4 недели перепроверяем. */
  deadTopics: Record<string, string>;
  /** Пустых ответов подряд с распознанной вёрсткой (страница темы есть, рилсов нет). Сбой или стена входа не в счёт. */
  topicMisses: Record<string, number>;
  pending: DiscoverProgress | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function readSocialState(capabilities: unknown): SocialState {
  const raw = (capabilities as { social?: unknown } | null)?.social as Record<string, unknown> | undefined;
  const topics = Array.isArray(raw?.autoTopics) ? (raw.autoTopics as unknown[]).filter((t): t is SeedTopic => isRecord(t) && typeof t.slug === "string" && (t.brand === "zara" || t.brand === "uniqlo")) : [];
  const deadTopics: Record<string, string> = {};
  // Прежний вид — список без даты: такие темы перепроверяем при первом же поиске.
  if (Array.isArray(raw?.deadTopics)) for (const slug of arr(raw.deadTopics)) deadTopics[slug] = RELEASED;
  else if (isRecord(raw?.deadTopics)) for (const [slug, at] of Object.entries(raw.deadTopics)) if (typeof at === "string") deadTopics[slug] = at;
  const topicMisses: Record<string, number> = {};
  if (isRecord(raw?.topicMisses)) for (const [slug, n] of Object.entries(raw.topicMisses)) if (Number.isFinite(Number(n)) && Number(n) > 0) topicMisses[slug] = Math.floor(Number(n));
  const p = isRecord(raw?.pending) ? raw.pending : null;
  const pending: DiscoverProgress | null = p && typeof p.startedAt === "string"
    ? {
      startedAt: p.startedAt, topics: arr(p.topics), google: arr(p.google), runs: Math.max(0, Math.floor(Number(p.runs) || 0)),
      newTopics: Array.isArray(p.newTopics) ? (p.newTopics as unknown[]).filter((t): t is SeedTopic => isRecord(t) && typeof t.slug === "string" && (t.brand === "zara" || t.brand === "uniqlo")) : [],
      withReels: Math.max(0, Math.floor(Number(p.withReels) || 0)),
    }
    : null;
  return { discoveredAt: typeof raw?.discoveredAt === "string" ? raw.discoveredAt : null, autoTopics: topics, deadTopics, topicMisses, pending };
}

async function loadState(db: SupabaseClient): Promise<{ capabilities: Record<string, unknown>; state: SocialState } | null> {
  const { data, error } = await db.from(SOURCES).select("capabilities").eq("source_id", SOCIAL_SOURCE_ID).maybeSingle();
  if (error) {
    if (missing(error)) return null;
    throw new Error(error.message);
  }
  if (!data) return null;
  const caps = (data as { capabilities?: unknown }).capabilities;
  const capabilities = caps && typeof caps === "object" && !Array.isArray(caps) ? { ...(caps as Record<string, unknown>) } : {};
  return { capabilities, state: readSocialState(capabilities) };
}

async function saveState(db: SupabaseClient, capabilities: Record<string, unknown>, state: SocialState): Promise<void> {
  const { error } = await db.from(SOURCES).update({ capabilities: { ...capabilities, social: state } }).eq("source_id", SOCIAL_SOURCE_ID);
  if (error) throw new Error(error.message);
}

/**
 * Пора ли искать: незавершённый поиск — продолжаем каждый прогон; иначе по метке последнего поиска; если источника S068 нет — по
 * самому свежему рилсу, найденному поиском.
 */
export function discoverDue(state: SocialState | null, posts: Iterable<PostRow>, nowMs: number): boolean {
  if (state?.pending) return true;
  let last = state?.discoveredAt ? ms(state.discoveredAt) : NaN;
  if (!state) {
    for (const p of posts) {
      if (p.found_via.includes("topic") || p.found_via.includes("google")) {
        const t = ms(p.first_seen_at);
        if (Number.isFinite(t) && !(t <= last)) last = t;
      }
    }
  }
  return !Number.isFinite(last) || nowMs - last >= DISCOVER_EVERY_DAYS * DAY_MS;
}

/** Темы поиска: стартовые и авто, без мёртвых — кроме тех, кого пора перепроверить (раз в 4 недели). */
export function activeTopics(state: SocialState | null, nowMs: number): SeedTopic[] {
  const dead = state?.deadTopics ?? {};
  const out: SeedTopic[] = [];
  for (const t of [...SEED_TOPICS, ...(state?.autoTopics ?? [])]) {
    const deadAt = dead[t.slug];
    if (deadAt != null && nowMs - ms(deadAt) < DEAD_TOPIC_RECHECK_DAYS * DAY_MS) continue;
    if (!out.some((o) => o.slug === t.slug)) out.push(t);
  }
  return out;
}

/** Ключ запроса Google в прогрессе поиска. */
const googleKey = (brand: SocialBrand, template: string) => `${brand}:${template}`;

// ---------------------------------------------------------------------------
// Аккаунты: правила без затирания ручного

/** Новый аккаунт, найденный прогоном: «увиден», не наблюдается, тип неизвестен. */
export function newAutoAccount(handle: string, nowMs: number): AccountRow {
  return {
    platform: SOCIAL_PLATFORM, handle, kind: "unknown", origin: "auto", status: "seen", note: null, followers: null, likes_median: null, comments_median: null,
    baseline_posts: null, baseline_at: null, appearances: 0, first_seen_at: iso(nowMs), last_checked_at: null, last_error: null,
  };
}

/**
 * Статус после прогона. Исключённый директором и заведённый вручную (owner) не трогаем; стартовый остаётся наблюдаемым;
 * авто-аккаунт «увиден» → «наблюдается», если за 30 дней появился в выдаче ≥ 2 раз. Обратно автоматически не понижаем.
 */
export function nextAccountStatus(account: Pick<AccountRow, "status" | "origin">, appearances: number): AccountStatus {
  if (account.status === "excluded" || account.origin !== "auto") return account.status;
  return account.status === "seen" && appearances >= WATCH_APPEARANCES ? "watched" : account.status;
}

/** Появления автора в выдаче (темы и Google, не профиль) за 30 дней — по разным рилсам. */
export function countAppearances(posts: Iterable<PostRow>, nowMs: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of posts) {
    if (!p.account_handle) continue;
    if (!p.found_via.includes("topic") && !p.found_via.includes("google")) continue;
    if (nowMs - ms(p.first_seen_at) > APPEARANCE_DAYS * DAY_MS) continue;
    out.set(p.account_handle, (out.get(p.account_handle) ?? 0) + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Кандидаты и замеры (чистые слияния — проверяются тестом)

export interface Candidate {
  code: string;
  kind: "reel" | "post";
  author: string | null;
  caption: string | null;
  hashtags: string[];
  views: number | null;
  via: "topic" | "google" | "profile" | "author";
  topic: string | null;
  brandHint: SocialBrand | null;
}

function refsOf(caption: string | null, hashtags: string[], brand: SocialBrand | null): string[] {
  const text = `${caption ?? ""} ${hashtags.map((h) => `#${h}`).join(" ")}`;
  return extractRefs(text, brand).map((r) => r.key);
}

/** Новый рилс из поиска или слияние с уже известным: источники и темы копятся, ручные поля и замеры не трогаются. */
export function mergeCandidate(existing: PostRow | undefined, c: Candidate, nowMs: number): PostRow {
  const publishedMs = existing?.published_at ? ms(existing.published_at) : NaN;
  const brandFromText = detectBrand({ caption: c.caption, hashtags: c.hashtags, topic: c.topic, refs: extractRefs(c.caption ?? "") }) ?? c.brandHint;
  if (existing) {
    const brand = existing.brand ?? brandFromText;
    const next: PostRow = {
      ...existing,
      account_handle: existing.account_handle ?? c.author,
      found_via: union(existing.found_via, [c.via]),
      topics: c.topic ? union(existing.topics, [c.topic]) : existing.topics,
      views: c.views ?? existing.views,
      brand,
      caption_excerpt: existing.caption_excerpt ?? sanitizeCaption(c.caption),
      hashtags: cleanHashtags(union(existing.hashtags, c.hashtags)),
      refs: union(existing.refs, refsOf(c.caption, c.hashtags, brand)),
      direction: existing.direction ?? detectDirection({ caption: c.caption, hashtags: c.hashtags, topic: c.topic }),
    };
    if (c.views != null && c.views !== existing.views) next.history = pushHistory(existing.history, { at: iso(nowMs), likes: existing.likes, comments: existing.comments, views: c.views });
    return next;
  }
  const codeDate = shortcodeToDate(c.code);
  const published = Number.isFinite(publishedMs) ? iso(publishedMs) : codeDate ? codeDate.toISOString() : null;
  return {
    platform: SOCIAL_PLATFORM,
    code: c.code,
    url: postUrl(c.code, c.kind),
    account_handle: c.author,
    published_at: published,
    first_seen_at: iso(nowMs),
    last_checked_at: null,
    checks: 0,
    found_via: [c.via],
    topics: c.topic ? [c.topic] : [],
    brand: brandFromText,
    direction: detectDirection({ caption: c.caption, hashtags: c.hashtags, topic: c.topic }),
    caption_excerpt: sanitizeCaption(c.caption),
    // Хэштеги про деньги («#цена4990руб», «#4990тг») не храним: цены из подписей не собираем.
    hashtags: cleanHashtags(c.hashtags),
    refs: refsOf(c.caption, c.hashtags, brandFromText),
    likes: null,
    comments: null,
    views: c.views,
    likes_hidden: null,
    intent_count: null,
    intent_total: null,
    likes_ratio: null,
    comments_ratio: null,
    verdict: null,
    verdict_preliminary: false,
    rule_version: null,
    history: c.views != null ? [{ at: iso(nowMs), likes: null, comments: null, views: c.views }] : [],
    match_status: looksMenswear(c.caption, c.topic) ? "men" : null,
    match_model_key: null,
    match_url: null,
    match_title: null,
    match_image: null,
    match_gender: null,
    match_checked_at: null,
    last_error: null,
  };
}

const isViralMark = (h: HistoryPoint | null | undefined) => h?.verdict === "viral" || h?.verdict === "strong";

/** Точка истории; не больше 10 последних, но отметку первого «залёта» не выбрасываем (по ней сводка выбирает неделю). */
export function pushHistory(history: readonly HistoryPoint[], point: HistoryPoint): HistoryPoint[] {
  const all = [...history, point];
  if (all.length <= HISTORY_LIMIT) return all;
  const mark = all.findIndex(isViralMark);
  if (mark < 0 || mark >= all.length - HISTORY_LIMIT) return all.slice(-HISTORY_LIMIT);
  return [all[mark], ...all.slice(-(HISTORY_LIMIT - 1))];
}

/**
 * Отметить первый «залёт»: вердикт впервые стал «залетает» или «сильный». Замер в этом же прогоне — отметка на его точке;
 * вердикт сменился позже замера (досчиталась база автора) — своя точка с временем смены.
 */
function markFirstViral(post: PostRow, verdict: "strong" | "viral", nowMs: number): HistoryPoint[] {
  if (post.history.some(isViralMark)) return post.history;
  const at = iso(nowMs);
  const last = post.history[post.history.length - 1];
  if (last && last.at === at) return [...post.history.slice(0, -1), { ...last, verdict }];
  return pushHistory(post.history, { at, likes: post.likes, comments: post.comments, views: post.views, verdict });
}

/**
 * Замер со страницы рилса: числа, доля «купить», подпись (если полная), номера, бренд, раздел; «мужское» — сразу в исключение.
 * `countCheck: false` — числа записываем, но замер не засчитываем (намерение не измерено: тел комментариев не видно) — пост
 * перемерим, а Б не судим как «нет».
 */
export function applyMeasurement(post: PostRow, page: ParsedReel, nowMs: number, options: { countCheck?: boolean; note?: string | null } = {}): PostRow {
  const caption = page.captionTruncated ? null : page.caption;
  const hashtags = cleanHashtags(union(post.hashtags, page.hashtags));
  const textRefs = extractRefs(`${caption ?? ""} ${page.hashtags.map((h) => `#${h}`).join(" ")}`, null);
  const brand = detectBrand({ caption: caption ?? post.caption_excerpt, hashtags, topic: post.topics[0] ?? null, refs: textRefs }) ?? post.brand;
  const refs = union(post.refs, refsOf(caption, page.hashtags, brand));
  // Мобильная вёрстка тел комментариев не отдаёт: прежнюю долю не затираем нулём.
  const intent = page.visibleComments.length > 0 ? intentShare(page.visibleComments, page.caption) : null;
  const counted = options.countCheck !== false;
  const next: PostRow = {
    ...post,
    url: postUrl(page.code, page.kind),
    account_handle: page.author ?? post.account_handle,
    likes: page.likes,
    likes_hidden: page.likesHidden,
    comments: page.comments ?? post.comments,
    intent_count: intent ? intent.count : post.intent_count,
    intent_total: intent ? intent.total : post.intent_total,
    caption_excerpt: caption ? sanitizeCaption(caption) : post.caption_excerpt,
    hashtags,
    refs,
    brand,
    direction: post.direction ?? detectDirection({ caption: caption ?? post.caption_excerpt, hashtags, alt: page.altItems, topic: post.topics[0] ?? null }),
    checks: counted ? post.checks + 1 : post.checks,
    // Не засчитан — и срок замера не сдвигаем: перемерим следующим прогоном.
    last_checked_at: counted ? iso(nowMs) : post.last_checked_at,
    last_error: options.note ?? null,
    history: pushHistory(post.history, { at: iso(nowMs), likes: page.likes, comments: page.comments ?? post.comments, views: post.views }),
  };
  if (!next.match_status && looksMenswear(caption, post.topics[0])) next.match_status = "men";
  return next;
}

/** База автора посчитана (хоть из нуля постов — тогда запасное правило). */
function hasBaseline(account: AccountRow | undefined): account is AccountRow {
  return Boolean(account?.baseline_at) && account?.baseline_posts != null;
}

/** Рилс с шансом «залететь» ждёт базы автора: замерен, в окне, прошёл предфильтр, а базы ещё нет. */
export function awaitsBaseline(post: PostRow, account: AccountRow | undefined, nowMs: number): boolean {
  if (post.hidden_at || (post.likes == null && post.comments == null) || !passesPrefilter(post)) return false;
  const t = ms(post.published_at);
  return Number.isFinite(t) && nowMs - t <= MAX_AGE_DAYS * DAY_MS && !hasBaseline(account);
}

/**
 * Вердикт по сохранённым числам и базе автора (без запросов). Старше 21 дня — прежний вердикт не трогаем.
 * Без базы автора: рилс с шансом (лайков ≥ 1 000, комментариев ≥ 30 или просмотров ≥ 100 000) не судим — ждёт базы (запасное
 * правило — только для посчитанной базы, где меньше 6 постов); без шанса — «обычно»: основное правило «залёта» не даст при любой
 * базе (А требует ≥ 1 000 лайков, Б — ≥ 30 комментариев). Б не измерено (тел комментариев не видели) и А нет — вердикта нет.
 */
export function judgePost(post: PostRow, account: AccountRow | undefined, nowMs: number): PostRow {
  const published = ms(post.published_at);
  if (!Number.isFinite(published) || (post.likes == null && post.comments == null)) return post;
  const age = nowMs - published;
  if (age > MAX_AGE_DAYS * DAY_MS) return post;
  const unjudged = (): PostRow => (post.verdict == null && !post.verdict_preliminary && post.likes_ratio == null && post.comments_ratio == null && post.rule_version == null
    ? post
    : { ...post, verdict: null, verdict_preliminary: false, rule_version: null, likes_ratio: null, comments_ratio: null });
  if (!hasBaseline(account)) {
    if (passesPrefilter(post)) return unjudged();
    return { ...post, verdict: age < MIN_AGE_MS ? "too_fresh" : "normal", verdict_preliminary: false, rule_version: REELS_RULE_VERSION, likes_ratio: null, comments_ratio: null };
  }
  const v = verdictV1({
    publishedAtMs: published,
    nowMs,
    likes: post.likes,
    comments: post.comments,
    intent: post.intent_total != null ? { count: post.intent_count ?? 0, total: post.intent_total } : null,
    baseline: { likesMedian: account.likes_median, commentsMedian: account.comments_median, likesPosts: account.baseline_posts as number },
    followers: account.followers ?? null,
  });
  if (v.verdict === "too_old") return post;
  if (v.bUnknown && v.verdict === "normal") return unjudged();
  const next: PostRow = { ...post, verdict: v.verdict, verdict_preliminary: v.preliminary, rule_version: v.ruleVersion, likes_ratio: v.likesRatio, comments_ratio: v.commentsRatio };
  if (v.verdict === "viral" || v.verdict === "strong") next.history = markFirstViral(post, v.verdict, nowMs);
  return next;
}

/** Привязку пора делать: «залетел», не скрыт, не мужское; ещё не привязан, или «не нашли / есть у бренда» старше недели. */
export function matchDue(post: PostRow, nowMs: number): boolean {
  if (post.verdict !== "viral" && post.verdict !== "strong") return false;
  if (post.hidden_at || post.match_status === "men" || post.match_status === "kids" || post.match_status === "catalog") return false;
  if (post.match_status == null || post.match_status === "pending") return true;
  if (post.match_status === "no_ref") return post.refs.length > 0;
  return nowMs - ms(post.match_checked_at) >= MATCH_RECHECK_DAYS * DAY_MS || !post.match_checked_at;
}

// ---------------------------------------------------------------------------
// Каталог Zara и Uniqlo по номеру

export interface CatalogHit {
  sourceId: string;
  itemId: string;
  modelKey: string;
  title: string | null;
  url: string | null;
  image: string | null;
  direction: AssortmentDirection | null;
}

export interface CatalogIndex {
  zara: Map<string, CatalogHit>;
  uniqlo: Map<string, CatalogHit>;
}

const ZARA_SOURCE = "S001";
const UNIQLO_SOURCE = "S003";

function firstImage(value: unknown): string | null {
  return arr(value).find((u) => /^https:\/\//.test(u) && thumbUrl(u) != null) ?? null;
}

/** Строки каталога Zara (S001) и Uniqlo (S003): ключ Zara — последние 7 цифр p-кода в адресе, Uniqlo — шесть цифр E-кода. */
export async function loadCatalogIndex(db: SupabaseClient): Promise<CatalogIndex> {
  const index: CatalogIndex = { zara: new Map(), uniqlo: new Map() };
  const read = async (sourceId: string, columns: string) => loadAllSupabasePages<Record<string, unknown>>((from, to) => db.from(SOURCE_ITEMS).select(columns)
    .eq("source_id", sourceId).not("direction", "is", null).order("source_item_id", { ascending: true }).range(from, to) as unknown as Page<Record<string, unknown>>, { label: `Каталог ${sourceId} для привязки рилсов` });
  for (const sourceId of [ZARA_SOURCE, UNIQLO_SOURCE]) {
    let rows: Record<string, unknown>[];
    try {
      rows = await read(sourceId, "source_id,source_item_id,handle,title,direction,model_key,image_urls");
    } catch (error) {
      if (missing(error)) return index;
      if (!isMissingColumnError({ message: error instanceof Error ? error.message : String(error) })) throw error;
      rows = await read(sourceId, "source_id,source_item_id,handle,title,direction");
    }
    for (const r of rows) {
      const itemId = String(r.source_item_id ?? "");
      const handle = typeof r.handle === "string" ? r.handle : null;
      const hit: CatalogHit = {
        sourceId, itemId, modelKey: typeof r.model_key === "string" && r.model_key ? r.model_key : `${sourceId}|${itemId}`,
        title: (r.title as string | null) ?? null, url: handle && /^https:\/\//.test(handle) ? handle : null, image: firstImage(r.image_urls),
        direction: (r.direction as AssortmentDirection | null) ?? null,
      };
      if (sourceId === ZARA_SOURCE) {
        const code = zaraModelCode(handle)?.slice(-7);
        if (code && !index.zara.has(code)) index.zara.set(code, hit);
      } else {
        const id = /^E(\d{6})-/.exec(itemId)?.[1] ?? (handle ? /\/products\/E(\d{6})-/.exec(handle)?.[1] : undefined);
        if (id && !index.uniqlo.has(id)) index.uniqlo.set(id, hit);
      }
    }
  }
  return index;
}

/** Модель каталога по ключу номера («zara:5854722», «uniqlo:487882»). */
export function catalogHitFor(index: CatalogIndex, refKey: string): CatalogHit | null {
  const [brand, model] = refKey.split(":");
  if (brand === "zara") return index.zara.get(model) ?? null;
  if (brand === "uniqlo") return index.uniqlo.get(model) ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Прогон

export type SocialFetcher = (url: string, format: UnlockerFormat) => Promise<UnlockerResult>;
export type SocialPhase = "discover" | "measure" | "match";
export type SocialStop = "budget" | "time" | "auth" | "billing" | "config";

export interface RunSocialOptions {
  config: SocialConfig;
  /** Задан ли ключ Bright Data (значение не нужно). */
  hasKey: boolean;
  fetchPage: SocialFetcher;
  phase?: SocialPhase | null;
  dryRun?: boolean;
  now?: () => number;
  /** Абсолютное время (мс), после которого новые запросы не начинаются. */
  deadlineMs?: number;
  parallel?: number;
}

export interface SocialRunSummary {
  skipped: string | null;
  skippedBecause: "off" | "no_schema" | "no_usage" | "no_key" | "busy" | null;
  stoppedBy: SocialStop | null;
  stopMessage: string | null;
  requests: number;
  failedRequests: number;
  weekRequestsBefore: number | null;
  allowed: number;
  /** Запросов, отложенных под замер и базу авторов: поиск их не трогает. */
  reserved: number;
  due: { discover: boolean; topics: number; google: number; profiles: number; measure: number; baselines: number; match: number };
  discover: {
    ran: boolean;
    /** Поиск дошёл до конца (метка поиска поставлена); нет — продолжим в следующий прогон с места остановки. */
    complete: boolean;
    resumed: boolean;
    topics: number;
    topicsWithReels: number;
    /** Ответов темы без распознанной вёрстки (стена входа, новая вёрстка) — тему в мёртвые из-за них не пишем. */
    topicsUnrecognized: number;
    newDeadTopics: number;
    google: number;
    profiles: number;
    candidates: number;
    newPosts: number;
    newTopics: number;
  };
  measured: number;
  notFound: number;
  /** Страниц рилсов без распознанного блока счётчиков: замер не засчитан. */
  layoutFailures: number;
  /**
   * Замеров без тел комментариев при ≥ 30 комментариях: намерение не измерено (Б — не «нет»). Мобильная вёрстка — замер не засчитан,
   * перемерим; десктоп — засчитан.
   */
  intentUnmeasured: number;
  baselines: number;
  /** Рилсов с шансом, что ждут базы автора: вердикта у них нет, досчитаем в следующих прогонах. */
  awaitingBaseline: number;
  judged: Record<"strong" | "viral" | "normal", number>;
  matched: Partial<Record<MatchStatus, number>>;
  errors: string[];
  /** Тревоги: прогон в журнале — «ошибка», даже если запросы прошли (вёрстка изменилась, поиск не завершается). */
  alarms: string[];
}

function emptySummary(): SocialRunSummary {
  return {
    skipped: null, skippedBecause: null, stoppedBy: null, stopMessage: null, requests: 0, failedRequests: 0, weekRequestsBefore: null, allowed: 0, reserved: 0,
    due: { discover: false, topics: 0, google: 0, profiles: 0, measure: 0, baselines: 0, match: 0 },
    discover: { ran: false, complete: false, resumed: false, topics: 0, topicsWithReels: 0, topicsUnrecognized: 0, newDeadTopics: 0, google: 0, profiles: 0, candidates: 0, newPosts: 0, newTopics: 0 },
    measured: 0, notFound: 0, layoutFailures: 0, intentUnmeasured: 0, baselines: 0, awaitingBaseline: 0, judged: { strong: 0, viral: 0, normal: 0 }, matched: {}, errors: [], alarms: [],
  };
}

/** Пул до `limit` параллельных задач; после остановки новые не берёт. */
async function pool<T>(items: readonly T[], limit: number, stopped: () => boolean, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (!stopped()) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
}

function profileDue(account: AccountRow, nowMs: number): boolean {
  return account.status === "watched" && (!account.last_checked_at || nowMs - ms(account.last_checked_at) >= PROFILE_EVERY_DAYS * DAY_MS);
}

function inJudgeWindow(post: PostRow, nowMs: number): boolean {
  const t = ms(post.published_at);
  return Number.isFinite(t) && nowMs - t <= MAX_AGE_DAYS * DAY_MS;
}

async function upsertChunks(db: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string, ignoreDuplicates = false): Promise<void> {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 200), { onConflict, ignoreDuplicates });
    if (error) throw new Error(error.message);
  }
}

function postPayload(post: PostRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of POST_MACHINE_COLUMNS) out[column] = (post as unknown as Record<string, unknown>)[column] ?? null;
  out.checks = post.checks;
  out.found_via = post.found_via;
  out.topics = post.topics;
  out.hashtags = post.hashtags;
  out.refs = post.refs;
  out.history = post.history;
  out.verdict_preliminary = post.verdict_preliminary;
  return out;
}

/** Машинные колонки аккаунта; статус, тип, происхождение и заметку прогон в обновлении не пишет. */
function accountMachinePayload(a: AccountRow): Record<string, unknown> {
  return {
    platform: a.platform, handle: a.handle, followers: a.followers, likes_median: a.likes_median, comments_median: a.comments_median, baseline_posts: a.baseline_posts,
    baseline_at: a.baseline_at, appearances: a.appearances, last_checked_at: a.last_checked_at, last_error: a.last_error,
  };
}

function accountFullPayload(a: AccountRow): Record<string, unknown> {
  return { ...accountMachinePayload(a), kind: a.kind, origin: a.origin, status: a.status, note: a.note, first_seen_at: a.first_seen_at };
}

const emptyState = (): SocialState => ({ discoveredAt: null, autoTopics: [], deadTopics: {}, topicMisses: {}, pending: null });

const GOOGLE_KEYS: ReadonlyArray<{ brand: SocialBrand; template: string; key: string }> = (["zara", "uniqlo"] as const)
  .flatMap((brand) => GOOGLE_QUERIES[brand].map((template) => ({ brand, template, key: googleKey(brand, template) })));

type BaselineNeed = { posts: PostRow[]; grid: GridPost[]; awaiting: boolean };

export async function runSocialReels(db: SupabaseClient, options: RunSocialOptions): Promise<SocialRunSummary> {
  const clock = options.now ?? Date.now;
  const nowMs = clock();
  const summary = emptySummary();
  const config = options.config;
  const parallel = Math.max(1, Math.min(options.parallel ?? MAX_PARALLEL, MAX_PARALLEL));
  if (!config.enabled) return { ...summary, skipped: "выключено (ASSORTMENT_SOCIAL=off)", skippedBecause: "off" };

  let accounts: Map<string, AccountRow>;
  let posts: Map<string, PostRow>;
  try {
    accounts = await loadAccounts(db);
    // Окно чтения шире окна суждения: появления автора считаются за 30 дней по дате находки, а найден рилс бывает в 21 день от роду.
    posts = await loadPosts(db, nowMs - (MAX_AGE_DAYS + APPEARANCE_DAYS) * DAY_MS);
  } catch (error) {
    if (missing(error)) return { ...summary, skipped: `таблицы «Залетает» не созданы — нужна миграция ${SOCIAL_MIGRATION}`, skippedBecause: "no_schema" };
    throw error;
  }
  const week = await loadWeekRequests(db, nowMs);
  if (week == null) return { ...summary, skipped: "нет таблицы учёта расхода assortment_ai_usage (миграция 202610050005) — платные запросы не начинаем", skippedBecause: "no_usage" };
  summary.weekRequestsBefore = week;
  summary.allowed = Math.max(0, Math.min(config.maxRequestsPerRun, config.weeklyRequests - week));

  const stateRow = await loadState(db);
  const state: SocialState = stateRow?.state ?? emptyState();
  const phase = options.phase ?? null;
  const excluded = (handle: string | null) => Boolean(handle && accounts.get(handle)?.status === "excluded");
  const seedsMissing = SEED_ACCOUNTS.filter((s) => !accounts.has(s.handle));
  const progressTopics = new Set(state.pending?.topics ?? []);
  const progressGoogle = new Set(state.pending?.google ?? []);
  const awaitingAuthors = new Set([...posts.values()]
    .filter((p) => p.account_handle && !excluded(p.account_handle) && awaitsBaseline(p, accounts.get(p.account_handle), nowMs))
    .map((p) => p.account_handle as string));

  summary.due.discover = phase === "discover" || (phase == null && discoverDue(stateRow?.state ?? null, posts.values(), nowMs));
  summary.due.topics = summary.due.discover ? activeTopics(state, nowMs).filter((t) => !progressTopics.has(t.slug)).length : 0;
  summary.due.google = summary.due.discover ? GOOGLE_KEYS.filter((q) => !progressGoogle.has(q.key)).length : 0;
  summary.due.profiles = phase === "measure" || phase === "match" ? 0 : [...accounts.values()].filter((a) => profileDue(a, nowMs)).length + seedsMissing.length;
  summary.due.measure = phase === "discover" || phase === "match" ? 0 : [...posts.values()].filter((p) => !p.hidden_at && !excluded(p.account_handle) && measureDue({ publishedAtMs: ms(p.published_at), checks: p.checks, lastCheckedAtMs: p.last_checked_at ? ms(p.last_checked_at) : null }, nowMs)).length;
  summary.due.baselines = phase === "discover" || phase === "match" ? 0 : awaitingAuthors.size;
  summary.due.match = phase === "discover" || phase === "measure" ? 0 : [...posts.values()].filter((p) => matchDue(p, nowMs)).length;
  // Резерв под замер и базу авторов (не больше половины прогона): поиск, упёршийся в потолок, не должен оставить замер без запросов.
  summary.reserved = phase == null
    ? Math.min(summary.due.measure + Math.min(summary.due.baselines, config.maxBaselineAuthorsPerRun) * (BASELINE_POSTS + 1), Math.floor(summary.allowed / 2))
    : 0;
  if (options.dryRun) return summary;
  if (!options.hasKey) return { ...summary, skipped: "нет ключа Bright Data (BRIGHTDATA_API_TOKEN)", skippedBecause: "no_key" };

  const lease = await acquireLease(db, nowMs);
  if (!lease) return { ...summary, skipped: "прогон уже идёт", skippedBecause: "busy" };

  const deadline = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  let usageFlushed = 0;
  let failedFlushed = 0;
  const dirtyPosts = new Set<string>();
  const dirtyAccounts = new Set<string>();
  const newAccounts = new Set<string>();
  /** Профили, скачанные в этом прогоне (поиск или база автора): второй раз не качаем. null — профиля нет (закрыт, удалён). */
  const profiles = new Map<string, ParsedProfile | null>();
  const stopped = () => summary.stoppedBy != null;
  /** Потолок шага: поиск не трогает резерв замера. Упёрся — шаг кончился, прогон идёт дальше. */
  let stepCap = Number.POSITIVE_INFINITY;
  let stepCut = false;
  const stepStopped = () => stopped() || stepCut;
  const note = (text: string) => {
    if (summary.errors.length < 12) summary.errors.push(text.slice(0, 200));
  };
  const alarm = (text: string) => {
    summary.alarms.push(text.slice(0, 240));
  };

  /** Один запрос с учётом: потолок прогона, недели и шага, дедлайн, остановки. null — не начат (стоп). Временный сбой — один повтор. */
  const request = async (url: string, format: UnlockerFormat, retry = true): Promise<UnlockerResult | null> => {
    if (stopped()) return null;
    if (summary.requests >= summary.allowed) {
      summary.stoppedBy = "budget";
      summary.stopMessage = summary.allowed === 0 ? "исчерпан потолок запросов недели" : "достигнут потолок запросов прогона или недели";
      return null;
    }
    if (summary.requests >= stepCap) {
      stepCut = true;
      return null;
    }
    if (clock() >= deadline) {
      summary.stoppedBy = "time";
      summary.stopMessage = "кончилось время прогона";
      return null;
    }
    summary.requests += 1;
    let result: UnlockerResult;
    try {
      result = await options.fetchPage(url, format);
    } catch (error) {
      if (isUnlockerStop(error)) {
        summary.stoppedBy = error.code;
        summary.stopMessage = error.message;
        return null;
      }
      result = { ok: false, kind: "transient", reason: error instanceof Error ? error.message.slice(0, 160) : "сбой запроса", ms: 0 };
    }
    if (!result.ok) {
      summary.failedRequests += 1;
      if (result.kind === "transient" && retry && !stopped()) {
        const again = await request(url, format, false);
        return again ?? result;
      }
    }
    return result;
  };

  const ensureAccount = (handle: string | null) => {
    if (!handle || accounts.has(handle)) return;
    accounts.set(handle, newAutoAccount(handle, nowMs));
    newAccounts.add(handle);
  };

  const putPost = (post: PostRow) => {
    posts.set(post.code, post);
    dirtyPosts.add(post.code);
  };

  const flush = async () => {
    const postRows = [...dirtyPosts].map((code) => posts.get(code)).filter((p): p is PostRow => Boolean(p)).map(postPayload);
    const fresh = [...newAccounts].map((h) => accounts.get(h)).filter((a): a is AccountRow => Boolean(a)).map(accountFullPayload);
    const updated = [...dirtyAccounts].filter((h) => !newAccounts.has(h)).map((h) => accounts.get(h)).filter((a): a is AccountRow => Boolean(a)).map(accountMachinePayload);
    if (fresh.length) await upsertChunks(db, ACCOUNTS, fresh, "platform,handle", true);
    if (updated.length) await upsertChunks(db, ACCOUNTS, updated, "platform,handle");
    if (postRows.length) await upsertChunks(db, POSTS, postRows, "platform,code");
    dirtyPosts.clear();
    dirtyAccounts.clear();
    newAccounts.clear();
    const add = { calls: summary.requests - usageFlushed, failed: summary.failedRequests - failedFlushed };
    if (add.calls > 0 || add.failed > 0) {
      await addSocialUsage(db, nowMs, add);
      usageFlushed = summary.requests;
      failedFlushed = summary.failedRequests;
    }
  };

  /**
   * База автора: медиана последних 12 постов по дате — из сеток «More posts from» замеренных рилсов и из сетки профиля (12 постов).
   * Профиль берём, если в сетках рилсов меньше 6 пригодных постов, если он уже скачан в этом прогоне, или если после подсчёта
   * постов с видимыми лайками всё ещё меньше 6 (закреплённые, соавторские и свежие посты съедают сетку рилса). Рилс кандидата в этом
   * прогоне не мерили (база досчитывается позже), а профиль постов не дал (стена входа, закрыт) — сетка со страницы самого кандидата.
   * false — база не сохранена (остановка или временный сбой): досчитаем в следующем прогоне.
   */
  const computeBaseline = async (author: string, account: AccountRow, need: BaselineNeed): Promise<boolean> => {
    const candidates = new Set(need.posts.map((p) => p.code));
    const grid = new Map<string, GridPost>();
    const addGrid = (list: readonly GridPost[]) => {
      for (const g of list) {
        if (g.owner !== author) continue;
        const prev = grid.get(g.code);
        grid.set(g.code, prev ? { ...prev, pinned: prev.pinned || g.pinned } : g);
      }
    };
    addGrid(need.grid);
    const eligible = () => [...grid.values()]
      .filter((g) => !g.pinned && !candidates.has(g.code) && g.publishedAt && nowMs - ms(g.publishedAt) >= MIN_AGE_MS)
      .sort((a, b) => ms(b.publishedAt) - ms(a.publishedAt))
      .slice(0, BASELINE_POSTS);
    const measured = new Map<string, BaselinePost>();
    let profileUsed = false;
    const takeProfileGrid = async (): Promise<boolean> => {
      profileUsed = true;
      let profile = profiles.get(author);
      if (profile === undefined) {
        const r = await request(profileUrl(author), "markdown");
        if (!r || (!r.ok && r.kind === "transient")) return false;
        profile = r.ok ? parseProfilePage(r.body) : null;
        profiles.set(author, profile);
      }
      if (profile?.followers != null) account.followers = profile.followers;
      if (profile) addGrid(profile.posts);
      return true;
    };
    const takeCandidateGrid = async (): Promise<boolean> => {
      const top = [...need.posts].sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1))[0];
      if (!top) return true;
      const r = await request(top.url, "markdown");
      if (!r || (!r.ok && r.kind === "transient")) return false;
      const page = r.ok ? parseReelPage(r.body) : null;
      if (page) addGrid(page.otherPosts);
      return true;
    };
    const fetchGrid = async (): Promise<boolean> => {
      const todo = eligible().filter((g) => !measured.has(g.code));
      let done = 0;
      await pool(todo, parallel, stopped, async (g) => {
        const stored = posts.get(g.code);
        // Уже мерили за неделю — берём из базы, страницу не качаем.
        if (stored && stored.checks > 0 && stored.last_checked_at && nowMs - ms(stored.last_checked_at) < BASELINE_FRESH_DAYS * DAY_MS && (stored.likes != null || stored.comments != null)) {
          measured.set(g.code, { code: g.code, publishedAtMs: ms(g.publishedAt), likes: stored.likes_hidden ? null : stored.likes, comments: stored.comments, owner: author });
          done += 1;
          return;
        }
        const r = await request(postUrl(g.code, g.kind), "markdown");
        if (!r) return;
        done += 1;
        if (!r.ok) return;
        const page = parseReelPage(r.body);
        // Без распознанного блока счётчиков лайки не «скрыты», а неизвестны — такой пост в базу не идёт.
        if (!page || !page.countsFound) return;
        measured.set(g.code, { code: g.code, publishedAtMs: ms(g.publishedAt), likes: page.likes, comments: page.comments, owner: page.author ?? author });
        // Свежий пост автора из сетки — сам кандидат (так нашёлся второй залёт jpnbrands).
        if (page.author === author && withinDiscoveryWindow(g.code, nowMs) && g.kind === "reel") {
          const base = posts.get(g.code) ?? mergeCandidate(undefined, { code: g.code, kind: g.kind, author, caption: null, hashtags: [], views: null, via: "author", topic: null, brandHint: null }, nowMs);
          putPost(applyMeasurement({ ...base, found_via: union(base.found_via, ["author"]) }, page, nowMs));
        }
      });
      return done === todo.length;
    };
    const short = () => eligible().length < MIN_BASELINE_LIKE_POSTS;
    if (short() || profiles.has(author)) {
      if (!(await takeProfileGrid())) return false;
    }
    if (short() && need.grid.length === 0) {
      if (!(await takeCandidateGrid())) return false;
    }
    if (!(await fetchGrid())) return false;
    let baseline = medianBaseline([...measured.values()], { nowMs, author });
    if (baseline.likesPosts < MIN_BASELINE_LIKE_POSTS && !profileUsed) {
      if (!(await takeProfileGrid())) return false;
      if (!(await fetchGrid())) return false;
      baseline = medianBaseline([...measured.values()], { nowMs, author });
    }
    account.likes_median = baseline.likesMedian;
    account.comments_median = baseline.commentsMedian;
    account.baseline_posts = baseline.likesPosts;
    account.baseline_at = iso(nowMs);
    return true;
  };

  try {
    // Стартовые аккаунты — при первом прогоне (существующие не трогаем: вставка без перезаписи).
    if (seedsMissing.length) {
      for (const seed of seedsMissing) {
        accounts.set(seed.handle, { ...newAutoAccount(seed.handle, nowMs), kind: seed.kind, origin: "seed", status: "watched", note: seed.note });
        newAccounts.add(seed.handle);
      }
    }

    const addCandidate = (c: Candidate, counters: { candidates: number; newPosts: number }) => {
      if (excluded(c.author)) return;
      // Только женское: явно мужское по подписи или теме не храним вовсе.
      if (!posts.has(c.code) && looksMenswear(c.caption, c.topic)) return;
      counters.candidates += 1;
      const existing = posts.get(c.code);
      if (!existing) counters.newPosts += 1;
      putPost(mergeCandidate(existing, c, nowMs));
      ensureAccount(c.author);
    };

    // (а) Поиск: темы и Google — раз в 6 дней (незавершённый — с места остановки); профили наблюдаемых — по их сроку.
    if (phase == null || phase === "discover") {
      const counters = { candidates: 0, newPosts: 0 };
      stepCap = summary.allowed - summary.reserved;
      if (summary.due.discover) {
        summary.discover.ran = true;
        summary.discover.resumed = state.pending != null;
        const progress: DiscoverProgress = state.pending ?? { startedAt: iso(nowMs), topics: [], google: [], runs: 0, newTopics: [], withReels: 0 };
        const doneTopics = new Set(progress.topics);
        const doneGoogle = new Set(progress.google);
        const topics = activeTopics(state, nowMs).filter((t) => !doneTopics.has(t.slug));
        const known = new Set([...SEED_TOPICS, ...state.autoTopics, ...progress.newTopics].map((t) => t.slug).concat(Object.keys(state.deadTopics)));
        const found: SeedTopic[] = [...progress.newTopics];
        // Пустая тема с распознанной вёрсткой или «страницы нет» — промах; TOPIC_DEAD_MISSES подряд — мёртвая (перепроверка мёртвой
        // снова пуста — ещё на 4 недели).
        const missTopic = (slug: string) => {
          const n = (state.topicMisses[slug] ?? 0) + 1;
          state.topicMisses[slug] = n;
          if (n >= TOPIC_DEAD_MISSES || state.deadTopics[slug] != null) {
            if (state.deadTopics[slug] == null) summary.discover.newDeadTopics += 1;
            state.deadTopics[slug] = iso(nowMs);
          }
        };
        // Ответы без рилсов: сбой страницы (стена входа, новая вёрстка, временный сбой) — тему повторим, если тревога; «страницы нет» — промах.
        const broken: string[] = [];
        let gone = 0;
        await pool(topics, parallel, stepStopped, async (topic) => {
          const r = await request(topicUrl(topic.slug), "markdown");
          if (!r) return;
          doneTopics.add(topic.slug);
          if (!r.ok) {
            if (r.kind === "failed") {
              gone += 1;
              missTopic(topic.slug);
            } else broken.push(topic.slug);
            return note(`тема ${topic.slug}: ${r.reason}`);
          }
          summary.discover.topics += 1;
          const page = parseTopicPage(r.body);
          if (!page || page.cards.length === 0) {
            // Пустая тема — только если Instagram сам пишет «0 reels». Стена входа, новая вёрстка или «4.3K reels» без карточек —
            // сбой страницы, а не пустая тема: в мёртвые из-за него не пишем.
            if (page?.recognized && page.total === 0) missTopic(topic.slug);
            else {
              summary.discover.topicsUnrecognized += 1;
              broken.push(topic.slug);
            }
            return;
          }
          summary.discover.topicsWithReels += 1;
          delete state.topicMisses[topic.slug];
          delete state.deadTopics[topic.slug];
          for (const card of page.cards) {
            if (!withinDiscoveryWindow(card.code, nowMs)) continue;
            addCandidate({ code: card.code, kind: "reel", author: card.author, caption: card.caption, hashtags: card.hashtags, views: card.views, via: "topic", topic: topic.slug, brandHint: topic.brand }, counters);
          }
          for (const n of page.neighbors) {
            const brand = acceptNeighborTopic(n.slug);
            if (brand && !known.has(n.slug) && !found.some((t) => t.slug === n.slug)) found.push({ slug: n.slug, brand });
          }
        });
        await pool(GOOGLE_KEYS.filter((q) => !doneGoogle.has(q.key)), parallel, stepStopped, async ({ brand, template, key }) => {
          const r = await request(googleSearchUrl(googleQuery(template, nowMs)), "parsed_light");
          if (!r) return;
          doneGoogle.add(key);
          if (!r.ok) return note(`Google «${template}»: ${r.reason}`);
          summary.discover.google += 1;
          for (const g of parseGoogleReels(r.body)) {
            if (!withinDiscoveryWindow(g.code, nowMs)) continue;
            addCandidate({ code: g.code, kind: g.kind, author: null, caption: null, hashtags: [], views: null, via: "google", topic: null, brandHint: brand }, counters);
          }
        });
        if (summary.discover.topicsUnrecognized > 0) note(`тем без распознанной вёрстки: ${summary.discover.topicsUnrecognized} (стена входа или новая вёрстка) — в мёртвые не записаны`);
        const withReels = progress.withReels + summary.discover.topicsWithReels;
        // Ни одна тема поиска не дала рилсов, а сбоев и «страницы нет» не меньше трёх — разбор сломан или стена входа у всех: тревога,
        // поиск не засчитываем, темы со сбоем — заново следующим прогоном.
        const noReels = withReels === 0 && broken.length + gone >= 3;
        if (noReels) {
          alarm(`ни одна тема не дала рилсов: без распознанной вёрстки или со сбоем — ${broken.length}, «страницы нет» — ${gone} — вёрстка Instagram изменилась или стена входа`);
          for (const slug of broken) doneTopics.delete(slug);
        }
        const remainingTopics = activeTopics(state, nowMs).filter((t) => !doneTopics.has(t.slug)).length;
        const remainingGoogle = GOOGLE_KEYS.filter((q) => !doneGoogle.has(q.key)).length;
        if (!noReels && remainingTopics === 0 && remainingGoogle === 0) {
          summary.discover.complete = true;
          const added = found.slice(0, NEW_TOPICS_PER_DISCOVER);
          summary.discover.newTopics = added.length;
          state.autoTopics = [...state.autoTopics, ...added].slice(-AUTO_TOPICS_MAX);
          state.discoveredAt = iso(nowMs);
          state.pending = null;
        } else {
          // Остановка (потолок, время, деньги) или тревога: пройденное запоминаем — следующий прогон продолжит, а не начнёт заново.
          state.pending = { startedAt: progress.startedAt, topics: [...doneTopics], google: [...doneGoogle], runs: progress.runs + 1, newTopics: found, withReels };
          if (state.pending.runs >= DISCOVER_STALL_RUNS) {
            alarm(`поиск не завершён прогонов подряд: ${state.pending.runs} (осталось тем: ${remainingTopics}, запросов Google: ${remainingGoogle}) — мал потолок запросов прогона или сбои`);
          }
        }
        if (stateRow) await saveState(db, stateRow.capabilities, state);
      }
      const dueProfiles = [...accounts.values()].filter((a) => profileDue(a, nowMs));
      await pool(dueProfiles, parallel, stepStopped, async (account) => {
        const r = await request(profileUrl(account.handle), "markdown");
        if (!r) return;
        dirtyAccounts.add(account.handle);
        if (!r.ok) {
          account.last_error = r.reason;
          // Окончательный отказ (профиля нет) — следующая попытка через срок, а не каждый день; временный — завтра.
          if (r.kind === "failed") {
            account.last_checked_at = iso(nowMs);
            profiles.set(account.handle, null);
          }
          return note(`профиль ${account.handle}: ${r.reason}`);
        }
        const profile = parseProfilePage(r.body);
        profiles.set(account.handle, profile);
        if (!profile) {
          account.last_error = "профиль не открылся (закрыт или удалён)";
          account.last_checked_at = iso(nowMs);
          return;
        }
        summary.discover.profiles += 1;
        account.followers = profile.followers ?? account.followers;
        account.last_checked_at = iso(nowMs);
        account.last_error = null;
        for (const p of profile.posts) {
          if (p.owner !== account.handle || p.kind !== "reel" || !withinDiscoveryWindow(p.code, nowMs)) continue;
          addCandidate({ code: p.code, kind: "reel", author: account.handle, caption: null, hashtags: [], views: null, via: "profile", topic: null, brandHint: null }, counters);
        }
      });
      summary.discover.candidates = counters.candidates;
      summary.discover.newPosts = counters.newPosts;
      stepCap = Number.POSITIVE_INFINITY;
      stepCut = false;
      await flush();
    }

    // (б) Замер: посты 2–21 дня — первый замер, затем на 3-й и 7-й день.
    const measuredPages = new Map<string, ParsedReel>();
    if (phase == null || phase === "measure") {
      const due = [...posts.values()]
        .filter((p) => !p.hidden_at && !excluded(p.account_handle) && measureDue({ publishedAtMs: ms(p.published_at), checks: p.checks, lastCheckedAtMs: p.last_checked_at ? ms(p.last_checked_at) : null }, nowMs))
        .sort((a, b) => a.checks - b.checks || (b.views ?? -1) - (a.views ?? -1) || ms(b.published_at) - ms(a.published_at));
      let parsed = 0;
      let desktopWithComments = 0;
      let desktopNoBodies = 0;
      await pool(due, parallel, stopped, async (post) => {
        const r = await request(post.url, "markdown");
        if (!r) return;
        if (!r.ok) {
          // Окончательный отказ — попытка засчитана (не больше трёх), временный — повторим в следующий прогон.
          putPost({ ...post, last_error: r.reason, checks: r.kind === "failed" ? post.checks + 1 : post.checks, last_checked_at: r.kind === "failed" ? iso(nowMs) : post.last_checked_at });
          return;
        }
        let page = parseReelPage(r.body);
        if (!page) {
          summary.notFound += 1;
          putPost({ ...post, last_error: "страницы рилса нет (удалён или закрыт)", checks: post.checks + 1, last_checked_at: iso(nowMs) });
          return;
        }
        // Мобильная вёрстка (Bright Data отдаёт её вперемешку с десктопной): тел комментариев нет, подпись обрезана — ещё один
        // запрос за десктопной, если от комментариев (Б) или номера в подписи что-то зависит.
        if (page.layout === "mobile" && ((page.comments ?? 0) >= COMMENTS_MIN || page.captionTruncated)) {
          const again = await request(post.url, "markdown", false);
          const second = again && again.ok ? parseReelPage(again.body) : null;
          if (second && second.code === page.code && second.layout === "desktop" && second.countsFound) page = second;
        }
        if (excluded(page.author)) {
          putPost({ ...post, account_handle: page.author, last_error: "автор исключён", checks: post.checks + 1, last_checked_at: iso(nowMs) });
          return;
        }
        parsed += 1;
        if (!page.countsFound) {
          // Рилс есть, а блока «Like / Comment / Share» нет — вёрстка изменилась: числа неизвестны (не 0), замер не засчитан.
          summary.layoutFailures += 1;
          putPost({ ...post, account_handle: page.author ?? post.account_handle, last_error: "не распознан блок счётчиков (вёрстка Instagram изменилась) — замер не засчитан" });
          return;
        }
        // Комментариев на (Б) хватает, а их тел не видно — намерение не измерено (не «нет»). Мобильная вёрстка (повтор за десктопной
        // не помог) — замер не засчитываем, перемерим следующим прогоном; десктоп без тел — засчитываем, а при массовом сбое — тревога.
        const intentMissing = (page.comments ?? 0) >= COMMENTS_MIN && page.visibleComments.length === 0 && post.intent_total == null;
        if (intentMissing) summary.intentUnmeasured += 1;
        if (page.layout === "desktop" && (page.comments ?? 0) >= COMMENTS_MIN) {
          desktopWithComments += 1;
          if (page.visibleComments.length === 0) desktopNoBodies += 1;
        }
        summary.measured += 1;
        measuredPages.set(post.code, page);
        putPost(applyMeasurement(post, page, nowMs, !intentMissing ? {} : page.layout === "mobile"
          ? { countCheck: false, note: "мобильная вёрстка: тела комментариев не видны — намерение не измерено, перемерим" }
          : { note: "тела комментариев не распознаны — намерение не измерено" }));
        ensureAccount(page.author);
      });
      if (summary.layoutFailures >= LAYOUT_ALARM_MIN && summary.layoutFailures * 2 >= parsed) {
        alarm(`у ${summary.layoutFailures} из ${parsed} рилсов не распознан блок счётчиков — вёрстка Instagram изменилась, замеры не засчитаны`);
      }
      if (desktopNoBodies >= LAYOUT_ALARM_MIN && desktopNoBodies * 2 >= desktopWithComments) {
        alarm(`у ${desktopNoBodies} из ${desktopWithComments} рилсов с комментариями не распознаны тела комментариев — условие Б не измеряется`);
      }

      // База автора: сначала авторы рилсов с шансом, что ждут базы (вердикта у них нет), затем устаревшие базы замеренных сейчас;
      // не больше N авторов за прогон — остальные досчитаются в следующих.
      const needs = new Map<string, BaselineNeed>();
      const need = (author: string): BaselineNeed => {
        let entry = needs.get(author);
        if (!entry) {
          entry = { posts: [], grid: [], awaiting: !hasBaseline(accounts.get(author)) };
          needs.set(author, entry);
        }
        return entry;
      };
      for (const [code, page] of measuredPages) {
        const post = posts.get(code);
        const author = post?.account_handle;
        if (!post || !author || excluded(author) || !passesPrefilter(post)) continue;
        const account = accounts.get(author);
        if (account?.baseline_at && nowMs - ms(account.baseline_at) < BASELINE_FRESH_DAYS * DAY_MS) continue;
        const entry = need(author);
        if (!entry.posts.some((p) => p.code === code)) entry.posts.push(post);
        entry.grid.push(...page.otherPosts.filter((g) => g.owner === author));
      }
      for (const post of posts.values()) {
        const author = post.account_handle;
        if (!author || excluded(author) || !awaitsBaseline(post, accounts.get(author), nowMs)) continue;
        const entry = need(author);
        if (!entry.posts.some((p) => p.code === post.code)) entry.posts.push(post);
      }
      const topLikes = (entry: BaselineNeed) => Math.max(0, ...entry.posts.map((p) => p.likes ?? 0));
      const queue = [...needs.entries()]
        .sort((a, b) => Number(b[1].awaiting) - Number(a[1].awaiting) || topLikes(b[1]) - topLikes(a[1]))
        .slice(0, config.maxBaselineAuthorsPerRun);
      for (const [author, entry] of queue) {
        if (stopped()) break;
        const account = accounts.get(author);
        if (!account) continue;
        if (!(await computeBaseline(author, account, entry))) continue;
        dirtyAccounts.add(author);
        summary.baselines += 1;
      }
    }

    // Вердикт — по сохранённым числам и текущей базе, без запросов.
    for (const post of [...posts.values()]) {
      if (!inJudgeWindow(post, nowMs)) continue;
      const account = post.account_handle ? accounts.get(post.account_handle) : undefined;
      const next = judgePost(post, account, nowMs);
      if (next !== post && (next.verdict !== post.verdict || next.verdict_preliminary !== post.verdict_preliminary || next.likes_ratio !== post.likes_ratio || next.comments_ratio !== post.comments_ratio || next.rule_version !== post.rule_version || next.history !== post.history)) putPost(next);
      const v = (next.verdict ?? "") as string;
      if (v === "strong" || v === "viral" || v === "normal") summary.judged[v] += 1;
      if (next.verdict == null && !excluded(next.account_handle) && awaitsBaseline(next, account, nowMs)) summary.awaitingBaseline += 1;
    }
    await flush();

    // (в) Привязка «залетевших» к модели.
    if (phase == null || phase === "match") {
      const due = [...posts.values()].filter((p) => matchDue(p, nowMs) && !excluded(p.account_handle));
      let catalog: CatalogIndex | null = null;
      const count = (status: MatchStatus) => {
        summary.matched[status] = (summary.matched[status] ?? 0) + 1;
      };
      for (const post of due) {
        if (stopped() && post.refs.length > 0) break;
        if (looksMenswear(post.caption_excerpt)) {
          putPost({ ...post, match_status: "men", match_checked_at: iso(nowMs) });
          count("men");
          continue;
        }
        if (post.refs.length === 0) {
          putPost({ ...post, match_status: "no_ref", match_checked_at: iso(nowMs) });
          count("no_ref");
          continue;
        }
        catalog ??= await loadCatalogIndex(db);
        const hit = post.refs.map((key) => catalogHitFor(catalog as CatalogIndex, key)).find((h): h is CatalogHit => Boolean(h));
        if (hit) {
          // Раздел — по модели каталога, а не по подписи: «#baggyjeans» в подписи куртку в «Сумки» не уводит.
          putPost({
            ...post, match_status: "catalog", match_model_key: hit.modelKey, match_url: hit.url, match_title: hit.title, match_image: hit.image, match_gender: "women",
            match_checked_at: iso(nowMs), direction: hit.direction ?? post.direction, last_error: null,
          });
          count("catalog");
          continue;
        }
        let transient = false;
        let result: { status: MatchStatus; card: { name: string; image: string | null; gender: CardGender }; url: string } | null = null;
        for (const key of post.refs.slice(0, BRAND_SITE_REFS)) {
          const [brand, model] = key.split(":");
          const urls = brand === "zara" ? [zaraCardUrl(model)] : brand === "uniqlo" ? uniqloCardUrls(model) : [];
          for (const url of urls) {
            const r = await request(url, "markdown");
            if (!r) break;
            if (!r.ok) {
              if (r.kind === "transient") transient = true;
              continue;
            }
            const card = brand === "zara" ? parseZaraCard(r.body, model) : parseUniqloCard(r.body, model);
            if (!card) continue;
            const status: MatchStatus = card.gender === "men" ? "men" : card.gender === "kids" ? "kids" : "brand_site";
            result = { status, card, url };
            break;
          }
          if (result || stopped()) break;
        }
        if (result) {
          putPost({
            ...post, match_status: result.status, match_model_key: null, match_url: result.url, match_title: result.card.name, match_image: result.card.image,
            match_gender: result.card.gender, match_checked_at: iso(nowMs), last_error: null,
            // Название карточки бренда с понятным разделом («… Jacket», «… Bag») сильнее подписи.
            direction: detectDirection({ title: result.card.name }) ?? post.direction,
          });
          count(result.status);
        } else if (stopped() || transient) {
          putPost({ ...post, match_status: "pending", last_error: transient ? "карточка бренда не открылась (временный сбой)" : post.last_error });
          count("pending");
        } else {
          putPost({ ...post, match_status: "not_found", match_checked_at: iso(nowMs) });
          count("not_found");
        }
      }
    }

    // Появления в выдаче и статусы авто-аккаунтов.
    const appearances = countAppearances(posts.values(), nowMs);
    const promote: string[] = [];
    for (const account of accounts.values()) {
      const n = appearances.get(account.handle) ?? 0;
      if (n !== account.appearances) {
        account.appearances = n;
        dirtyAccounts.add(account.handle);
      }
      const status = nextAccountStatus(account, n);
      if (status !== account.status) {
        account.status = status;
        if (newAccounts.has(account.handle)) continue;
        promote.push(account.handle);
      }
    }
    await flush();
    for (const handle of promote) {
      // Повышение — условным обновлением: если директор успел поменять статус, его правка не затирается.
      const { error } = await db.from(ACCOUNTS).update({ status: "watched" }).eq("platform", SOCIAL_PLATFORM).eq("handle", handle).eq("status", "seen").eq("origin", "auto");
      if (error) throw new Error(error.message);
    }
  } finally {
    try {
      const add = { calls: summary.requests - usageFlushed, failed: summary.failedRequests - failedFlushed };
      if (add.calls > 0 || add.failed > 0) await addSocialUsage(db, nowMs, add);
    } finally {
      await releaseLease(db, nowMs, lease);
    }
  }
  return summary;
}

/**
 * Строка журнала прогона для сторожа. «error»: остановка по деньгам, ключу или зоне, все запросы упали, или тревога (вёрстка
 * Instagram изменилась, поиск не завершается) — даже если запросы прошли. «partial»: потолок, время или поиск продолжится завтра.
 */
export function socialRunLog(summary: SocialRunSummary): { status: "ok" | "partial" | "error"; note: string | null } {
  const hardStop = summary.stoppedBy === "billing" || summary.stoppedBy === "auth" || summary.stoppedBy === "config";
  const nothingWorked = summary.requests > 0 && summary.failedRequests >= summary.requests;
  const alarmed = summary.alarms.length > 0;
  const discoverUnfinished = summary.discover.ran && !summary.discover.complete;
  const unfinished = summary.stoppedBy === "budget" || summary.stoppedBy === "time" || discoverUnfinished;
  const status = hardStop || nothingWorked || alarmed ? "error" : unfinished ? "partial" : "ok";
  const note = [
    alarmed ? summary.alarms.join("; ") : null,
    discoverUnfinished && !alarmed ? "поиск не дошёл до конца — продолжим в следующий прогон" : null,
    summary.stopMessage,
    summary.failedRequests > 0 ? `сбоев страниц: ${summary.failedRequests} из ${summary.requests}` : null,
    summary.errors.length ? summary.errors.slice(0, 3).join("; ") : null,
  ].filter(Boolean).join(". ");
  return { status, note: note || null };
}

// ---------------------------------------------------------------------------
// Чтение для ленты «Залетает»

export type NumberKind = "fact" | "calc" | "estimate" | "hypothesis";
export const NUMBER_KIND_LABEL: Record<NumberKind, string> = { fact: "факт", calc: "расчёт", estimate: "оценка", hypothesis: "гипотеза" };

export interface SocialReelCard {
  code: string;
  url: string;
  kind: "reel" | "post";
  author: { handle: string | null; url: string | null; kind: AccountKind | null; followers: number | null };
  publishedAt: string | null;
  brand: SocialBrand | null;
  direction: AssortmentDirection;
  captionExcerpt: string | null;
  hashtags: string[];
  refs: string[];
  verdict: "strong" | "viral";
  preliminary: boolean;
  ruleVersion: string | null;
  likes: number | null;
  likesHidden: boolean;
  comments: number | null;
  views: number | null;
  intent: { count: number; total: number; share: number | null } | null;
  likesRatio: number | null;
  commentsRatio: number | null;
  baseline: { likesMedian: number | null; commentsMedian: number | null; posts: number | null } | null;
  checks: number;
  lastCheckedAt: string | null;
  history: HistoryPoint[];
  /** Разных авторов с тем же номером товара в окне ±14 дней (включая этого). */
  sameRefAuthors14d: number;
  /** Предварительный вердикт подтверждён вторым автором с той же вещью. */
  confirmedBySecondAuthor: boolean;
  match: {
    status: MatchStatus | null;
    title: string | null;
    image: string | null;
    url: string | null;
    modelKey: string | null;
    sourceId: string | null;
    itemId: string | null;
    gender: CardGender | null;
  };
  /** Происхождение чисел: факт / расчёт / оценка / гипотеза (лайки и просмотры Instagram округляет). */
  kinds: Record<"likes" | "comments" | "views" | "intent" | "ratios" | "verdict" | "publishedAt" | "sameRefAuthors" | "match", NumberKind>;
}

export interface ViralReelsResult {
  cards: SocialReelCard[];
  /** Когда прогон последний раз что-то мерил (по рилсам). */
  lastCheckedAt: string | null;
  /** Что не загрузилось — называем, а не прячем. */
  warnings: string[];
}

const SAME_REF_WINDOW_MS = 14 * DAY_MS;

function heavyKind(n: number | null): NumberKind {
  return n != null && n >= 1000 ? "estimate" : "fact";
}

/**
 * Лента «Залетает»: «залетевшие» рилсы раздела за `days` дней (по умолчанию 21), без скрытых, мужских и детских, без исключённых
 * авторов, только Zara и Uniqlo. null — таблиц нет (миграция не применена): вкладку прячем, причина одной строкой.
 */
export async function loadViralReels(db: SupabaseClient, options: { direction: AssortmentDirection; days?: number; onlyStrong?: boolean; nowMs?: number }): Promise<ViralReelsResult | null> {
  const nowMs = options.nowMs ?? Date.now();
  const days = Math.max(1, Math.min(options.days ?? MAX_AGE_DAYS, 60));
  const since = nowMs - days * DAY_MS;
  let posts: PostRow[];
  let accounts: Map<string, AccountRow>;
  try {
    posts = [...(await loadPosts(db, since - SAME_REF_WINDOW_MS)).values()];
    accounts = await loadAccounts(db);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  const warnings: string[] = [];
  const authorsByRef = new Map<string, Array<{ handle: string; at: number }>>();
  for (const p of posts) {
    if (!p.account_handle || accounts.get(p.account_handle)?.status === "excluded") continue;
    for (const ref of p.refs) {
      const list = authorsByRef.get(ref) ?? [];
      list.push({ handle: p.account_handle, at: ms(p.published_at) });
      authorsByRef.set(ref, list);
    }
  }
  const wanted = new Set<SocialVerdict>(options.onlyStrong ? ["strong"] : ["strong", "viral"]);
  const shown = posts.filter((p) =>
    p.verdict != null && wanted.has(p.verdict) && p.direction === options.direction && !p.hidden_at
    && (p.brand === "zara" || p.brand === "uniqlo")
    && p.match_status !== "men" && p.match_status !== "kids"
    && ms(p.published_at) >= since
    && !(p.account_handle && accounts.get(p.account_handle)?.status === "excluded"));

  // Фото и название модели каталога — свежие из вида голов (фото Zara докачиваются позже привязки); сбой — берём сохранённое и говорим.
  const heads = new Map<string, { title: string | null; image: string | null; url: string | null }>();
  const catalogKeys = shown.filter((p) => p.match_status === "catalog" && p.match_model_key).map((p) => p.match_model_key as string);
  const bySource = new Map<string, string[]>();
  for (const key of catalogKeys) {
    const at = key.indexOf("|");
    if (at <= 0) continue;
    const list = bySource.get(key.slice(0, at)) ?? [];
    list.push(key.slice(at + 1));
    bySource.set(key.slice(0, at), list);
  }
  for (const [sourceId, ids] of bySource) {
    try {
      const rows = await rowsByIds<Record<string, unknown>>([...new Set(ids)], "Модели каталога для «Залетает»", (part, from, to) => db.from(HEADS_VIEW)
        .select("source_id,source_item_id,title,handle,image_urls").eq("source_id", sourceId).in("source_item_id", part).order("source_item_id", { ascending: true }).range(from, to) as unknown as Page<Record<string, unknown>>);
      for (const r of rows) heads.set(`${sourceId}|${String(r.source_item_id)}`, { title: (r.title as string | null) ?? null, image: firstImage(r.image_urls), url: typeof r.handle === "string" && /^https:\/\//.test(r.handle) ? r.handle : null });
    } catch (error) {
      warnings.push(`фото моделей каталога ${sourceId} не загрузились: ${error instanceof Error ? error.message.slice(0, 120) : "ошибка"}`);
    }
  }

  const cards = shown.map((p): SocialReelCard => {
    const account = p.account_handle ? accounts.get(p.account_handle) : undefined;
    const published = ms(p.published_at);
    const authors = new Set<string>();
    for (const ref of p.refs) {
      for (const a of authorsByRef.get(ref) ?? []) if (Number.isFinite(a.at) && Math.abs(a.at - published) <= SAME_REF_WINDOW_MS) authors.add(a.handle);
    }
    if (p.account_handle && p.refs.length) authors.add(p.account_handle);
    const at = p.match_model_key ? p.match_model_key.indexOf("|") : -1;
    const head = p.match_model_key ? heads.get(p.match_model_key) : undefined;
    const rawImage = head?.image ?? p.match_image;
    const verdict = p.verdict as "strong" | "viral";
    return {
      code: p.code,
      url: p.url,
      kind: p.url.includes("/p/") ? "post" : "reel",
      author: { handle: p.account_handle, url: p.account_handle ? profileUrl(p.account_handle) : null, kind: account?.kind ?? null, followers: account?.followers ?? null },
      publishedAt: p.published_at,
      brand: p.brand,
      direction: options.direction,
      captionExcerpt: p.caption_excerpt,
      hashtags: cleanHashtags(p.hashtags),
      refs: p.refs,
      verdict,
      preliminary: p.verdict_preliminary,
      ruleVersion: p.rule_version,
      likes: p.likes,
      likesHidden: p.likes_hidden === true,
      comments: p.comments,
      views: p.views,
      intent: p.intent_total ? { count: p.intent_count ?? 0, total: p.intent_total, share: Math.round(((p.intent_count ?? 0) / p.intent_total) * 100) / 100 } : null,
      likesRatio: p.likes_ratio,
      commentsRatio: p.comments_ratio,
      baseline: account && account.baseline_at ? { likesMedian: account.likes_median, commentsMedian: account.comments_median, posts: account.baseline_posts } : null,
      checks: p.checks,
      lastCheckedAt: p.last_checked_at,
      history: p.history,
      sameRefAuthors14d: authors.size,
      confirmedBySecondAuthor: authors.size >= 2,
      match: {
        status: p.match_status,
        title: head?.title ?? p.match_title,
        // Только ссылка: превью — с сайта бренда или из каталога; картинки Instagram не показываем и не копируем.
        image: rawImage && !isInstagramImage(rawImage) ? thumbUrl(rawImage) : null,
        url: head?.url ?? p.match_url,
        modelKey: p.match_model_key,
        sourceId: at > 0 ? (p.match_model_key as string).slice(0, at) : null,
        itemId: at > 0 ? (p.match_model_key as string).slice(at + 1) : null,
        gender: p.match_gender,
      },
      kinds: {
        likes: heavyKind(p.likes),
        comments: "fact",
        views: heavyKind(p.views),
        intent: "estimate",
        ratios: "calc",
        verdict: p.verdict_preliminary ? "hypothesis" : "calc",
        publishedAt: "calc",
        sameRefAuthors: "calc",
        match: "fact",
      },
    };
  });
  cards.sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === "strong" ? -1 : 1)
    || Number(a.preliminary) - Number(b.preliminary)
    || (b.likesRatio ?? b.commentsRatio ?? 0) - (a.likesRatio ?? a.commentsRatio ?? 0)
    || (b.views ?? 0) - (a.views ?? 0));
  const lastCheckedAt = posts.reduce<string | null>((max, p) => (p.last_checked_at && (!max || p.last_checked_at > max) ? p.last_checked_at : max), null);
  return { cards, lastCheckedAt, warnings };
}

/** Для тестов и экрана: ключ превью сохраняется ссылкой, не копией. */
export function isInstagramImage(url: string | null | undefined): boolean {
  return Boolean(url && /cdninstagram\.com|fbcdn\.net|instagram\.com/i.test(url));
}
