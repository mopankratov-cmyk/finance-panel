import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { CatalogCard } from "./catalog";
import type { AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema } from "./errors";
import type { SocialEvidence } from "./evidence";
import {
  DEFAULT_FEED_PERIOD, nextSocialRun, pickSocialDigest, SOCIAL_JOB, socialPass, type FeedPeriod, type SocialDigest, type SocialDigestPost, type SocialProgress,
} from "./socialFeed";
import { hasChance, MAX_AGE_DAYS, measuresPerRunEstimate, profileUrl, SOCIAL_PLATFORM, socialConfig, socialRefKeyFromUrl, type AccountKind, type SocialConfig } from "./socialReels";
import { loadAccounts, loadViralReels, postMeasureDue, SOCIAL_MIGRATION, type PostRow, type SocialReelCard } from "./socialReelsStore";

/**
 * «Залетает в соцсетях» — чтение и ручные правки для экрана, сводки, каталога и карточки модели. Сбор — в socialReelsStore.ts.
 *
 * Без миграции 202610060011 всё здесь тихо отвечает «недоступно» (вкладки нет, метки нет, в карточке — прежняя заглушка), другие сбои
 * чтения называются. Аккаунтами-источниками управляет директор (роут проверяет роль); скрыть рилс может любая роль модуля — как
 * «Не интересно» в каталоге.
 */

const POSTS = "assortment_social_post";
const ACCOUNTS = "assortment_social_account";
const DAY_MS = 24 * 3600 * 1000;
/** Каталожные источники, к моделям которых привязываются рилсы (Zara, Uniqlo). */
const SOCIAL_CATALOG_SOURCES = new Set(["S001", "S003"]);
/** Метка «залетает» в каталоге — по рилсам за 30 дней. */
const CATALOG_FLAG_DAYS = 30;

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
type DbError = { code?: string | null; message?: string | null } | null | undefined;

/** Таблиц «Залетает» нет (миграция не применена). */
export function isSocialTableMissing(error: unknown): boolean {
  const e = error as DbError;
  const message = error instanceof Error ? error.message : String(e?.message ?? error ?? "");
  return e?.code === "42P01" || e?.code === "PGRST205" || isMissingAssortmentSchema(new Error(message));
}

export const SOCIAL_UNAVAILABLE = `Сбор рилсов включится после обновления базы (миграция ${SOCIAL_MIGRATION}).`;

const iso = (ms: number) => new Date(ms).toISOString();
const errorText = (error: unknown) => (error instanceof Error ? error.message : String((error as DbError)?.message ?? error ?? "ошибка")).slice(0, 160);

async function excludedHandles(db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db.from(ACCOUNTS).select("handle").eq("platform", SOCIAL_PLATFORM).eq("status", "excluded");
  if (error) throw error;
  return new Set(((data ?? []) as Array<{ handle: string }>).map((r) => String(r.handle)));
}

// ---------------------------------------------------------------------------
// Вкладка и лента

export type SocialCount = { available: false; reason: string } | { available: true; total: number; collected: number };

/** Всего рилсов в базе (любой раздел): от первой записи вкладка видна. Не HEAD: у HEAD нет тела, ошибку «таблицы нет» не узнать. */
async function countPosts(db: SupabaseClient): Promise<number> {
  const { count, error } = await db.from(POSTS).select("code", { count: "exact" }).eq("platform", SOCIAL_PLATFORM).limit(1);
  if (error) throw error;
  return count ?? 0;
}

const PROGRESS_COLUMNS = "code,direction,published_at,checks,last_checked_at,likes,comments,views,verdict,hidden_at,account_handle";
type ProgressRow = Pick<PostRow, "code" | "direction" | "published_at" | "checks" | "last_checked_at" | "likes" | "comments" | "views" | "verdict" | "hidden_at" | "account_handle">;

/**
 * Честные счётчики вкладки: рилсов раздела за период найдено, замерено, ждут замера и из них с шансом; рилсы без раздела (раздел станет
 * известен после замера) — по всем разделам; сколько прогонов до полного прохода очереди замера (все разделы, окно 2–21 день). Скрытые и
 * рилсы исключённых авторов не в счёте — прогон их не мерит. Чтение листанием (рилсов бывает больше 1 000).
 */
export async function loadSocialProgress(db: SupabaseClient, options: { direction: AssortmentDirection; days: number; nowMs: number; config?: SocialConfig }): Promise<SocialProgress> {
  const { direction, days, nowMs } = options;
  const config = options.config ?? socialConfig();
  const since = nowMs - Math.max(days, MAX_AGE_DAYS) * DAY_MS;
  const periodFrom = nowMs - days * DAY_MS;
  const rows = await loadAllSupabasePages<ProgressRow>((from, to) => db.from(POSTS).select(PROGRESS_COLUMNS).eq("platform", SOCIAL_PLATFORM)
    .gte("published_at", iso(since)).order("code", { ascending: true }).range(from, to) as unknown as Page<ProgressRow>, { label: "Счётчики «Залетает»" });
  const excluded = rows.length ? await excludedHandles(db) : new Set<string>();
  const section = { found: 0, measured: 0, waiting: 0, waitingWithChance: 0 };
  const unsorted = { found: 0, waiting: 0, waitingWithChance: 0 };
  let waitingAll = 0;
  for (const raw of rows) {
    const p = { ...raw, checks: Number(raw.checks) || 0, likes: num(raw.likes), comments: num(raw.comments), views: num(raw.views) };
    if (p.hidden_at || (p.account_handle && excluded.has(p.account_handle))) continue;
    const due = postMeasureDue(p, nowMs);
    const chance = due && hasChance(p);
    if (due) waitingAll += 1;
    if (!(Date.parse(String(p.published_at)) >= periodFrom)) continue;
    if (p.direction === direction) {
      section.found += 1;
      if (p.checks > 0 && (p.likes != null || p.comments != null)) section.measured += 1;
      if (due) section.waiting += 1;
      if (chance) section.waitingWithChance += 1;
    } else if (p.direction == null) {
      unsorted.found += 1;
      if (due) unsorted.waiting += 1;
      if (chance) unsorted.waitingWithChance += 1;
    }
  }
  // Оценка по половине окна прогона: пока идёт поиск, замеру — вторая половина (оценка снизу по скорости, а не обещание).
  return { days, section, unsorted, pass: socialPass(waitingAll, measuresPerRunEstimate(config, true), config.weeklyRequests) };
}

const num = (value: unknown): number | null => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

/** Для вкладки: таблицы есть и хоть одна запись — вкладка видна; total — «залетевших» раздела за 14 дней (число на вкладке). */
export async function countSocialFeed(db: SupabaseClient, direction: AssortmentDirection, nowMs: number): Promise<SocialCount> {
  let collected: number;
  try {
    collected = await countPosts(db);
  } catch (error) {
    if (isSocialTableMissing(error)) return { available: false, reason: SOCIAL_UNAVAILABLE };
    throw new Error(errorText(error));
  }
  if (collected === 0) return { available: true, total: 0, collected };
  const feed = await loadViralReels(db, { direction, days: DEFAULT_FEED_PERIOD, nowMs });
  if (!feed) return { available: false, reason: SOCIAL_UNAVAILABLE };
  return { available: true, total: feed.cards.length, collected };
}

export interface SocialRunStatus {
  lastRunAt: string | null;
  lastStatus: "ok" | "partial" | "error" | null;
  /** Пометка последнего прогона (причина остановки, сбои страниц, «выключено»). */
  lastNote: string | null;
  lastOkAt: string | null;
  nextRunAt: string;
}

/** Последние прогоны крона по журналу синхронизаций — для строки «сбор: последний — …, следующий — …». */
export async function loadSocialRunStatus(db: SupabaseClient, nowMs: number): Promise<SocialRunStatus> {
  const { data, error } = await db.from("sync_log").select("status,error,started_at").eq("job", SOCIAL_JOB).order("started_at", { ascending: false }).limit(20);
  if (error) throw error;
  const runs = ((data ?? []) as Array<{ status: string; error: string | null; started_at: string }>).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  const last = runs[0];
  const status = last && (last.status === "ok" || last.status === "partial" || last.status === "error") ? last.status : null;
  return {
    lastRunAt: last?.started_at ?? null,
    lastStatus: status,
    // Метка `[stop:billing]` нужна сторожу задач, на вкладке она лишняя.
    lastNote: last?.error ? String(last.error).replace(/\s*\[stop:[a-z_]+\]\s*$/, "").slice(0, 240) || null : null,
    lastOkAt: runs.find((r) => r.status === "ok" || r.status === "partial")?.started_at ?? null,
    nextRunAt: nextSocialRun(nowMs),
  };
}

export type SocialFeedResult =
  | { available: false; reason: string }
  | {
    available: true;
    cards: SocialReelCard[];
    days: FeedPeriod;
    onlyStrong: boolean;
    /** Замерено рилсов раздела за период — чтобы «ничего не залетело» не читалось как «ничего не собрано». null — не посчиталось. */
    measured: number | null;
    /** Найдено, замерено, ждут замера (с шансом), без раздела, до полного прохода. null — не посчиталось (причина в warnings). */
    progress: SocialProgress | null;
    lastCheckedAt: string | null;
    run: SocialRunStatus | null;
    warnings: string[];
  };

export async function loadSocialFeed(db: SupabaseClient, options: { direction: AssortmentDirection; days: FeedPeriod; onlyStrong: boolean; nowMs: number }): Promise<SocialFeedResult> {
  const feed = await loadViralReels(db, { direction: options.direction, days: options.days, onlyStrong: options.onlyStrong, nowMs: options.nowMs });
  if (!feed) return { available: false, reason: SOCIAL_UNAVAILABLE };
  const warnings = [...feed.warnings];
  const [progress, run] = await Promise.all([
    loadSocialProgress(db, { direction: options.direction, days: options.days, nowMs: options.nowMs }).catch((error) => {
      warnings.push(`сколько рилсов найдено и замерено — не посчиталось: ${errorText(error)}`);
      return null;
    }),
    loadSocialRunStatus(db, options.nowMs).catch((error) => {
      warnings.push(`журнал сбора не загрузился: ${errorText(error)}`);
      return null;
    }),
  ]);
  return {
    available: true, cards: feed.cards, days: options.days, onlyStrong: options.onlyStrong, measured: progress?.section.measured ?? null, progress, lastCheckedAt: feed.lastCheckedAt, run, warnings,
  };
}

/** «Не интересен рилс»: своя отметка рилса (модель в каталоге этим не скрывается). */
export async function setReelHidden(db: SupabaseClient, code: string, hidden: boolean, who: string, nowMs = Date.now()): Promise<"ok" | "not_found" | "migration_missing"> {
  const { data, error } = await db.from(POSTS)
    .update(hidden ? { hidden_at: iso(nowMs), hidden_by: who.slice(0, 200) } : { hidden_at: null, hidden_by: null })
    .eq("platform", SOCIAL_PLATFORM).eq("code", code).select("code");
  if (error) {
    if (isSocialTableMissing(error)) return "migration_missing";
    throw new Error(errorText(error));
  }
  return data && data.length > 0 ? "ok" : "not_found";
}

// ---------------------------------------------------------------------------
// Аккаунты-источники

export interface SocialAccountView {
  handle: string;
  url: string;
  kind: AccountKind;
  origin: "seed" | "auto" | "owner";
  status: "watched" | "seen" | "excluded";
  note: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  /** Сколько рилсов автора «залетели» (за всё время сбора). */
  viral: number;
}

export interface SocialAccountsResult {
  accounts: SocialAccountView[];
  /** Авторов, что встречались в выдаче, но пока не наблюдаются (станут наблюдаемыми после второго появления за 30 дней). */
  seen: number;
}

/** Наблюдаемые и исключённые аккаунты (наблюдаемые — первыми, по числу «залётов»). null — таблиц нет. */
export async function loadSocialAccountsView(db: SupabaseClient): Promise<SocialAccountsResult | null> {
  let accounts: Awaited<ReturnType<typeof loadAccounts>>;
  let viralRows: Array<{ account_handle: string | null }>;
  try {
    accounts = await loadAccounts(db);
    viralRows = await loadAllSupabasePages<{ account_handle: string | null }>((from, to) => db.from(POSTS).select("code,account_handle")
      .eq("platform", SOCIAL_PLATFORM).in("verdict", ["strong", "viral"]).order("code", { ascending: true }).range(from, to) as unknown as Page<{ account_handle: string | null }>, { label: "Залёты по авторам" });
  } catch (error) {
    if (isSocialTableMissing(error)) return null;
    throw error;
  }
  const viral = new Map<string, number>();
  for (const r of viralRows) if (r.account_handle) viral.set(r.account_handle, (viral.get(r.account_handle) ?? 0) + 1);
  const list: SocialAccountView[] = [];
  let seen = 0;
  for (const a of accounts.values()) {
    if (a.status === "seen") {
      seen += 1;
      continue;
    }
    list.push({ handle: a.handle, url: profileUrl(a.handle), kind: a.kind, origin: a.origin, status: a.status, note: a.note, lastCheckedAt: a.last_checked_at, lastError: a.last_error, viral: viral.get(a.handle) ?? 0 });
  }
  list.sort((a, b) => Number(a.status === "excluded") - Number(b.status === "excluded") || b.viral - a.viral || a.handle.localeCompare(b.handle));
  return { accounts: list, seen };
}

export type AccountChange = "ok" | "unchanged" | "not_found" | "conflict" | "migration_missing";

/** Исключить аккаунт (прогон его больше не трогает) или вернуть в наблюдаемые. Условным обновлением: чужая правка не затирается. */
export async function setSocialAccountStatus(db: SupabaseClient, handle: string, action: "exclude" | "restore"): Promise<AccountChange> {
  const { data, error } = await db.from(ACCOUNTS).select("status").eq("platform", SOCIAL_PLATFORM).eq("handle", handle).maybeSingle();
  if (error) {
    if (isSocialTableMissing(error)) return "migration_missing";
    throw new Error(errorText(error));
  }
  if (!data) return "not_found";
  const current = String((data as { status: string }).status);
  if (action === "exclude" ? current === "excluded" : current !== "excluded") return "unchanged";
  const { data: updated, error: updateError } = await db.from(ACCOUNTS).update({ status: action === "exclude" ? "excluded" : "watched" })
    .eq("platform", SOCIAL_PLATFORM).eq("handle", handle).eq("status", current).select("handle");
  if (updateError) throw new Error(errorText(updateError));
  return updated && updated.length > 0 ? "ok" : "conflict";
}

/**
 * Добавить аккаунт вручную: новый — «добавлен вручную», наблюдается; встречавшийся или исключённый — наблюдается (найденный сбором
 * становится «добавлен вручную», чтобы прогон не трогал его статус); уже наблюдаемый — без изменений.
 */
export async function addSocialAccount(db: SupabaseClient, handle: string, kind: AccountKind): Promise<"created" | "watched" | "already" | "conflict" | "migration_missing"> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await db.from(ACCOUNTS).select("status,origin,kind").eq("platform", SOCIAL_PLATFORM).eq("handle", handle).maybeSingle();
    if (error) {
      if (isSocialTableMissing(error)) return "migration_missing";
      throw new Error(errorText(error));
    }
    if (!data) {
      const { error: insertError } = await db.from(ACCOUNTS).insert({ platform: SOCIAL_PLATFORM, handle, kind, origin: "owner", status: "watched" });
      if (!insertError) return "created";
      if ((insertError as DbError)?.code === "23505") continue;
      if (isSocialTableMissing(insertError)) return "migration_missing";
      throw new Error(errorText(insertError));
    }
    const row = data as { status: string; origin: string; kind: string };
    const patch: Record<string, unknown> = {};
    if (row.status !== "watched") patch.status = "watched";
    if (row.origin === "auto") patch.origin = "owner";
    if (row.kind === "unknown" && kind !== "unknown") patch.kind = kind;
    if (Object.keys(patch).length === 0) return "already";
    const { data: updated, error: updateError } = await db.from(ACCOUNTS).update(patch).eq("platform", SOCIAL_PLATFORM).eq("handle", handle).eq("status", row.status).select("handle");
    if (updateError) throw new Error(errorText(updateError));
    if (!updated || updated.length === 0) return "conflict";
    return row.status === "watched" ? "already" : "watched";
  }
  return "conflict";
}

// ---------------------------------------------------------------------------
// Метка «залетает» в каталоге брендов

/** Ключ модели каталога для привязки рилсов: у Zara (S001) и Uniqlo (S003) модель = строка, ключ `${source}|${item}`. */
export function socialModelKey(sourceId: string, itemId: string): string | null {
  return SOCIAL_CATALOG_SOURCES.has(sourceId) ? `${sourceId}|${itemId}` : null;
}

/**
 * Метка «залетает» на моделях порции каталога: «залетевшие» за 30 дней рилсы, привязанные к модели, не скрытые, автор не исключён.
 * Метка второстепенная: таблиц нет или чтение упало — каталог показывается без неё (true — метки проставлены).
 */
export async function attachSocialFlags(db: SupabaseClient, cards: CatalogCard[], nowMs: number): Promise<boolean> {
  const byKey = new Map<string, CatalogCard[]>();
  for (const card of cards) {
    const key = socialModelKey(card.sourceId, card.itemId);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), card]);
  }
  if (byKey.size === 0) return false;
  try {
    const { data, error } = await db.from(POSTS).select("match_model_key,verdict,account_handle")
      .eq("platform", SOCIAL_PLATFORM).eq("match_status", "catalog").in("match_model_key", [...byKey.keys()]).in("verdict", ["strong", "viral"])
      .is("hidden_at", null).gte("published_at", iso(nowMs - CATALOG_FLAG_DAYS * DAY_MS));
    if (error) return false;
    const rows = (data ?? []) as Array<{ match_model_key: string; verdict: string; account_handle: string | null }>;
    if (rows.length === 0) return true;
    const excluded = await excludedHandles(db);
    for (const r of rows) {
      if (r.account_handle && excluded.has(r.account_handle)) continue;
      for (const card of byKey.get(r.match_model_key) ?? []) {
        const strong = r.verdict === "strong" || card.social?.verdict === "strong";
        card.social = { verdict: strong ? "strong" : "viral", reels: (card.social?.reels ?? 0) + 1 };
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Карточка модели: строка «Независимые публикации»

const MODEL_POST_COLUMNS = "code,url,account_handle,verdict,verdict_preliminary,views,likes,last_checked_at,rule_version,hidden_at";
type ModelPost = { code: string; url: string; account_handle: string | null; verdict: string | null; verdict_preliminary: boolean | null; views: number | null; likes: number | null; last_checked_at: string | null; rule_version: string | null; hidden_at: string | null };

const isSocialBrand = (value: string | null | undefined) => /\b(zara|uniqlo)\b/i.test(value ?? "");
const isSocialBrandUrl = (url: string | null | undefined) => {
  try {
    return Boolean(url) && /(^|\.)(zara\.com|uniqlo\.com)$/i.test(new URL(String(url)).hostname);
  } catch {
    return false;
  }
};

/**
 * Рилсы, привязанные к находке: по модели каталога (находка отобрана из каталога Zara/Uniqlo) или по номеру модели из адреса карточки
 * бренда (находка добавлена ссылкой — «Добавить в находки» из ленты). Адрес находки хранится нормализованным (без www, Uniqlo — без
 * витрины), у рилса — как открыли: строки адресов не совпадут, номер совпадёт. null — таблиц нет: в карточке прежняя заглушка.
 */
export async function loadModelSocial(db: SupabaseClient, ref: { id: string; url: string | null; brand: string | null }): Promise<SocialEvidence | null> {
  const empty: SocialEvidence = { reels: 0, authors: 0, strong: false, preliminaryOnly: false, topUrl: null, topViews: null, topLikes: null, lastCheckedAt: null, ruleVersion: null };
  try {
    const { data: items, error: itemsError } = await db.from("assortment_source_items").select("source_id,source_item_id").eq("reference_id", ref.id);
    if (itemsError) throw itemsError;
    const keys = [...new Set(((items ?? []) as Array<{ source_id: string; source_item_id: string }>).map((r) => socialModelKey(String(r.source_id), String(r.source_item_id))).filter((k): k is string => Boolean(k)))];
    const url = ref.url && /^https:\/\//.test(ref.url) && isSocialBrandUrl(ref.url) ? ref.url : null;
    // Рилсы собираются только про Zara и Uniqlo: у другой модели «не найдено» было бы неправдой — говорим, что её не смотрели.
    if (keys.length === 0 && !url) return isSocialBrand(ref.brand) ? empty : { ...empty, outOfScope: true };
    const reads: Array<PromiseLike<{ data: unknown; error: unknown }>> = [];
    if (keys.length) reads.push(db.from(POSTS).select(MODEL_POST_COLUMNS).eq("platform", SOCIAL_PLATFORM).in("match_model_key", keys));
    const refKey = socialRefKeyFromUrl(url);
    if (refKey) reads.push(db.from(POSTS).select(MODEL_POST_COLUMNS).eq("platform", SOCIAL_PLATFORM).contains("refs", [refKey]));
    if (url) reads.push(db.from(POSTS).select(MODEL_POST_COLUMNS).eq("platform", SOCIAL_PLATFORM).eq("match_url", url));
    const results = await Promise.all(reads);
    const byCode = new Map<string, ModelPost>();
    for (const r of results) {
      if (r.error) throw r.error;
      for (const p of (r.data ?? []) as ModelPost[]) byCode.set(String(p.code), p);
    }
    const viral = [...byCode.values()].filter((p) => (p.verdict === "strong" || p.verdict === "viral") && !p.hidden_at);
    if (viral.length === 0) return empty;
    const excluded = await excludedHandles(db);
    const shown = viral.filter((p) => !(p.account_handle && excluded.has(p.account_handle)));
    if (shown.length === 0) return empty;
    const top = [...shown].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.likes ?? -1) - (a.likes ?? -1))[0];
    return {
      reels: shown.length,
      authors: new Set(shown.map((p) => p.account_handle ?? p.code)).size,
      strong: shown.some((p) => p.verdict === "strong"),
      preliminaryOnly: shown.every((p) => p.verdict_preliminary === true),
      topUrl: top.url ?? null,
      topViews: top.views ?? null,
      topLikes: top.likes ?? null,
      lastCheckedAt: shown.reduce<string | null>((max, p) => (p.last_checked_at && (!max || p.last_checked_at > max) ? p.last_checked_at : max), null),
      ruleVersion: top.rule_version ?? null,
    };
  } catch (error) {
    if (isSocialTableMissing(error)) return null;
    return { ...empty, failed: errorText(error) };
  }
}

// ---------------------------------------------------------------------------
// Воскресная сводка

const DIGEST_COLUMNS = "code,url,account_handle,published_at,first_seen_at,brand,direction,caption_excerpt,likes,views,verdict,match_status,match_title,hidden_at,history";

/** Новые «залёты» недели для сводки; null — таблиц нет или за неделю ничего не залетело (раздела в сводке нет). */
export async function loadSocialDigest(db: SupabaseClient, from: Date, to: Date): Promise<SocialDigest | null> {
  let posts: SocialDigestPost[];
  let excluded: Set<string>;
  try {
    // Рилс судят до 21 дня от публикации, а впервые замерить могли в последний из них: окно публикации — с запасом. Вердикт
    // («залетает» / «сильный») отбирает pickSocialDigest: в запросе — только «уже судили».
    const since = iso(from.getTime() - 30 * DAY_MS);
    posts = await loadAllSupabasePages<SocialDigestPost>((a, b) => db.from(POSTS).select(DIGEST_COLUMNS).eq("platform", SOCIAL_PLATFORM)
      .not("verdict", "is", null).gte("published_at", since).order("code", { ascending: true }).range(a, b) as unknown as Page<SocialDigestPost>, { label: "Залёты недели" });
    excluded = posts.length ? await excludedHandles(db) : new Set();
  } catch (error) {
    if (isSocialTableMissing(error)) return null;
    throw error;
  }
  const digest = pickSocialDigest(posts, from.getTime(), to.getTime(), excluded);
  return digest.items.length ? digest : null;
}
