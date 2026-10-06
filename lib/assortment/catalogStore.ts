import type { SupabaseClient } from "@supabase/supabase-js";
import {
  brandStats, CATALOG_FRESH_DAYS, CATALOG_SEEN_DAYS, ilikePattern, resolvePhotoMode, toCatalogCard,
  type CatalogBrandStat, type CatalogCard, type CatalogQuery, type CatalogRow,
} from "./catalog";
import { isMissingAssortmentSchema, isMissingColumnError } from "./errors";
import { FORM_UNRECOGNIZED } from "./catalog";
import { formOf } from "./forms";
import { baseHeadsFilters } from "./headsBase";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { attachSocialFlags } from "./socialFeedStore";

export interface CatalogPage {
  cards: CatalogCard[];
  total: number;
  /** Счётчики брендов — только на первой порции; null, если представления ещё нет. */
  brands: CatalogBrandStat[] | null;
  /** Какой режим фото действует на самом деле (в т.ч. выбранный сервером при «auto»). */
  photo: "with" | "all";
  /** Миграции 202610040001 нет: фото и фильтры каталога появятся после неё. */
  photosPending: boolean;
  /** Фильтр формы, который сервер применил (нет — не применял: ключ неизвестен разделу или фильтра не было). */
  form?: string | null;
}

/**
 * Вид «голов» моделей (миграция 202610050002): одна карточка на модель, дата и
 * «новинка» — по самой ранней расцветке. Нет вида — читаем таблицу строк, как раньше.
 */
const HEADS_VIEW = "assortment_catalog_heads";
const HEADS_COLUMNS = "source_id,source_item_id,handle,title,product_type,first_seen_at:model_first_seen_at,last_seen_at:model_last_seen_at,baseline:model_baseline,reference_id,image_urls,brand,badges,variants";
const HEADS_RECHECK_MS = 10 * 60 * 1000;
let headsMissingAt = 0;
const headsLikelyMissing = () => Date.now() - headsMissingAt < HEADS_RECHECK_MS;

/** Сброс признака «вида нет» — для тестов. */
export function resetHeadsFlag(): void {
  headsMissingAt = 0;
}

const BASE_COLUMNS = "source_id,source_item_id,handle,title,product_type,first_seen_at,last_seen_at,baseline,reference_id";
const CATALOG_COLUMNS = `${BASE_COLUMNS},image_urls,brand,badges`;

/** Паспорт источников (названия, адреса сайтов) меняется редко — держим 10 минут. */
let sourcesCache: { at: number; map: Map<string, { name: string; seedUrl: string | null }> } | null = null;

async function sourcesMap(db: SupabaseClient, nowMs: number) {
  if (sourcesCache && nowMs - sourcesCache.at < 10 * 60 * 1000) return sourcesCache.map;
  const { data, error } = await db.from("assortment_sources").select("source_id,name,seed_urls");
  if (error) throw new Error(error.message);
  const map = new Map<string, { name: string; seedUrl: string | null }>();
  for (const row of (data ?? []) as Array<{ source_id: string; name: string | null; seed_urls: unknown }>) {
    const seeds = Array.isArray(row.seed_urls) ? row.seed_urls.filter((s): s is string => typeof s === "string" && /^https?:\/\//.test(s)) : [];
    map.set(row.source_id, { name: row.name ?? row.source_id, seedUrl: seeds[0] ?? null });
  }
  sourcesCache = { at: nowMs, map };
  return map;
}

/** Общие фильтры вида голов: раздел, «виден за 30 дней», не скрыта, фото, метка, бренд, поиск, новинка. */
function headsFilters<T extends { eq: Function; gte: Function; is: Function; not: Function; or: Function }>(builder: T, query: CatalogQuery, nowMs: number, photo: "with" | "all"): T {
  let q: any = baseHeadsFilters(builder, query.direction, nowMs);
  if (photo === "with") q = q.not("image_urls", "is", null);
  if (query.badge) q = q.not("badges", "is", null);
  if (query.sourceId) q = q.eq("source_id", query.sourceId);
  if (query.search) {
    const pattern = ilikePattern(query.search);
    q = q.or(`title.ilike.${pattern},brand.ilike.${pattern}`);
  }
  // Новинка — по самой ранней расцветке модели: новый цвет старой модели новинкой не становится.
  if (query.fresh) q = q.eq("model_baseline", false).gte("model_first_seen_at", new Date(nowMs - CATALOG_FRESH_DAYS * 24 * 3600 * 1000).toISOString());
  return q as T;
}

function selectHeads(db: SupabaseClient, query: CatalogQuery, nowMs: number, photo: "with" | "all") {
  return headsFilters(db.from(HEADS_VIEW).select(HEADS_COLUMNS, { count: "exact" }), query, nowMs, photo)
    .order("model_first_seen_at", { ascending: false })
    .order("source_id", { ascending: true })
    .order("source_item_id", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1);
}

interface LightHead {
  source_id: string;
  source_item_id: string;
  title: string | null;
}

/**
 * Модели одной формы. Форма считается по названию (регулярные выражения — в PostgREST их не перевести), поэтому
 * список строится так же, как на «Формах»: все модели раздела по тем же фильтрам, форма по названию — в памяти,
 * порядок и страница — как у обычного каталога. Полные карточки (фото, бренд) читаются только для страницы.
 * null — вида голов нет (миграция 202610050002): фильтр по форме до неё недоступен.
 */
async function loadCatalogByForm(
  db: SupabaseClient, query: CatalogQuery, nowMs: number, photo: "with" | "all",
): Promise<{ rows: CatalogRow[]; total: number } | null> {
  const form = query.form!;
  let light: LightHead[];
  try {
    light = await loadAllSupabasePages<LightHead>((from, to) => headsFilters(db.from(HEADS_VIEW).select("source_id,source_item_id,title"), query, nowMs, photo)
      .order("model_first_seen_at", { ascending: false })
      .order("source_id", { ascending: true })
      .order("source_item_id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: LightHead[] | null; error: { message: string } | null }>, { label: "Модели формы", pageSize: 1000 });
  } catch (error) {
    if (headsUnavailable({ message: error instanceof Error ? error.message : "" })) return null;
    throw error;
  }
  const matching = light.filter((r) => {
    const rule = formOf(query.direction, r.title);
    return form === FORM_UNRECOGNIZED ? !rule : rule?.key === form;
  });
  const pageIds = matching.slice(query.offset, query.offset + query.limit);
  if (pageIds.length === 0) return { rows: [], total: matching.length };
  // Полные строки страницы — по источникам: `in` сам берёт в кавычки значения с запятыми и скобками.
  const bySource = new Map<string, string[]>();
  for (const r of pageIds) bySource.set(r.source_id, [...(bySource.get(r.source_id) ?? []), r.source_item_id]);
  const fetched = await Promise.all([...bySource.entries()].map(async ([sourceId, ids]) => {
    const { data, error } = await db.from(HEADS_VIEW).select(HEADS_COLUMNS).eq("direction", query.direction).eq("source_id", sourceId).in("source_item_id", ids);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as CatalogRow[];
  }));
  const byKey = new Map(fetched.flat().map((r) => [`${r.source_id}:${r.source_item_id}`, r]));
  // Порядок страницы — как в списке (свежие первыми), а не как ответили запросы.
  const rows = pageIds.map((r) => byKey.get(`${r.source_id}:${r.source_item_id}`)).filter((r): r is CatalogRow => Boolean(r));
  return { rows, total: matching.length };
}

/** Ошибка «вида (или его колонки) ещё нет» — миграцию 202610050002 не применили. */
function headsUnavailable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return isMissingAssortmentSchema(new Error(error.message ?? "")) || isMissingColumnError(error) || error.code === "PGRST205" || error.code === "42P01";
}

function select(db: SupabaseClient, query: CatalogQuery, nowMs: number, withCatalogColumns: boolean, photo: "with" | "all") {
  const seenSince = new Date(nowMs - CATALOG_SEEN_DAYS * 24 * 3600 * 1000).toISOString();
  let q = db.from("assortment_source_items")
    .select(withCatalogColumns ? CATALOG_COLUMNS : BASE_COLUMNS, { count: "exact" })
    .eq("direction", query.direction)
    .gte("last_seen_at", seenSince);
  if (withCatalogColumns) {
    q = q.is("hidden_at", null);
    if (photo === "with") q = q.not("image_urls", "is", null);
    if (query.badge) q = q.not("badges", "is", null);
  }
  if (query.sourceId) q = q.eq("source_id", query.sourceId);
  if (query.search) {
    const pattern = ilikePattern(query.search);
    q = withCatalogColumns ? q.or(`title.ilike.${pattern},brand.ilike.${pattern}`) : q.ilike("title", pattern);
  }
  if (query.fresh) q = q.eq("baseline", false).gte("first_seen_at", new Date(nowMs - CATALOG_FRESH_DAYS * 24 * 3600 * 1000).toISOString());
  return q
    .order("first_seen_at", { ascending: false })
    .order("source_id", { ascending: true })
    .order("source_item_id", { ascending: true })
    .range(query.offset, query.offset + query.limit - 1);
}

async function loadStats(db: SupabaseClient, query: CatalogQuery, names: Map<string, string>): Promise<CatalogBrandStat[] | null> {
  const { data, error } = await db.from("assortment_catalog_stats").select("source_id,direction,models,with_photo,new_7d").eq("direction", query.direction);
  if (error) return null;
  return brandStats((data ?? []) as Array<{ source_id: string; direction: string; models: number; with_photo: number; new_7d: number }>, query.direction, names);
}

/** Статус уже связанных находок — один запрос на порцию (до 96 id): карточка показывает правду. true — запрос был. */
async function attachStatuses(db: SupabaseClient, cards: CatalogCard[]): Promise<boolean> {
  const linked = [...new Set(cards.map((c) => c.referenceId).filter((id): id is string => Boolean(id)))];
  if (linked.length === 0) return false;
  const { data: refs } = await db.from("assortment_references").select("id,status").in("id", linked);
  const status = new Map((refs ?? []).map((r) => [String(r.id), String(r.status)]));
  for (const card of cards) if (card.referenceId) card.referenceStatus = status.get(card.referenceId) ?? null;
  return true;
}

/**
 * Порция каталога: один запрос к базе обхода (индекс по разделу и дате), без
 * подписанных ссылок и без списков id; счётчики брендов — параллельно. До
 * миграции — те же модели без фото.
 */
export async function loadCatalog(db: SupabaseClient, query: CatalogQuery, nowMs: number, timing?: (name: string) => void): Promise<CatalogPage> {
  const sources = await sourcesMap(db, nowMs);
  timing?.("sources");
  const names = new Map([...sources].map(([id, s]) => [id, s.name]));
  // Режим фото «auto» решают счётчики — тогда они нужны до выборки; иначе — параллельно.
  const needStats = query.offset === 0 || query.photo === "auto";
  const statsPromise = needStats ? loadStats(db, query, names) : Promise.resolve(null);
  const stats = query.photo === "auto" ? await statsPromise : null;
  // С фильтром формы «auto» не решаем по общей доле фото: число в плашке должно совпасть со строкой формы (там считаются все модели).
  const photo = query.form && query.photo === "auto" ? "all" : resolvePhotoMode(query.photo, stats, query.sourceId);
  let photosPending = false;
  if (query.form) {
    const byForm = await loadCatalogByForm(db, query, nowMs, photo);
    if (!byForm) throw new Error(`Фильтр по форме заработает после применения миграции 202610050002 (вид assortment_catalog_heads): без него в базе нет моделей одной карточкой.`);
    timing?.("items");
    const cards = byForm.rows.map((row) => toCatalogCard(row, sources.get(row.source_id), nowMs, query.direction));
    await Promise.all([attachStatuses(db, cards), attachSocialFlags(db, cards, nowMs)]);
    timing?.("statuses");
    return { cards, total: byForm.total, brands: query.offset === 0 ? await statsPromise : null, photo, photosPending: false, form: query.form };
  }
  // Откат решает ошибка САМОГО запроса к виду, а не общий флаг: два запроса
  // уходят одновременно (счётчик вкладки и первая порция), и пока один выставил
  // флаг «вида нет», второй обязан откатиться тоже — иначе ложная ошибка.
  const triedHeads = !headsLikelyMissing();
  let [result, brands] = triedHeads
    ? await Promise.all([selectHeads(db, query, nowMs, photo), statsPromise])
    : [await select(db, query, nowMs, true, photo), await statsPromise];
  if (triedHeads && result.error && headsUnavailable(result.error)) {
    headsMissingAt = Date.now();
    result = await select(db, query, nowMs, true, photo);
  }
  if (result.error && isMissingColumnError(result.error)) {
    photosPending = true;
    brands = null;
    result = await select(db, query, nowMs, false, "all");
  }
  if (result.error) throw new Error(result.error.message);
  timing?.("items");
  const rows = (result.data ?? []) as unknown as CatalogRow[];
  const cards = rows.map((row) => toCatalogCard(row, sources.get(row.source_id), nowMs, query.direction));
  // Метка «залетает» — параллельно со статусами находок; второстепенная: без таблиц рилсов или при сбое каталог идёт без неё.
  const [statuses, social] = await Promise.all([attachStatuses(db, cards), attachSocialFlags(db, cards, nowMs)]);
  if (statuses) timing?.("statuses");
  if (social) timing?.("social");
  return { cards, total: result.count ?? cards.length, brands: query.offset === 0 ? brands : null, photo: photosPending ? "all" : photo, photosPending, form: null };
}

/**
 * Только число моделей раздела (для вкладки): одна строка и подсчёт, без
 * счётчиков брендов. Не HEAD: у HEAD нет тела, и ошибка «нет колонки» до
 * миграции приходит пустой — откат её не узнаёт (04.10 вкладка не появилась).
 */
export async function countCatalog(db: SupabaseClient, query: CatalogQuery, nowMs: number): Promise<number> {
  const one = { ...query, offset: 0, limit: 1 };
  const triedHeads = !headsLikelyMissing();
  let result = triedHeads ? await selectHeads(db, one, nowMs, "all") : await select(db, one, nowMs, true, "all");
  if (triedHeads && result.error && headsUnavailable(result.error)) {
    headsMissingAt = Date.now();
    result = await select(db, one, nowMs, true, "all");
  }
  if (result.error && isMissingColumnError(result.error)) result = await select(db, one, nowMs, false, "all");
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}

/** Ссылка на фото строки — для запасного пути, когда браузер не смог открыть её сам. */
export async function catalogImageUrl(db: SupabaseClient, sourceId: string, itemId: string, index: number): Promise<string | null> {
  const { data, error } = await db.from("assortment_source_items").select("image_urls").eq("source_id", sourceId).eq("source_item_id", itemId).maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) return null;
    throw new Error(error.message);
  }
  const urls = (data as { image_urls?: unknown } | null)?.image_urls;
  return Array.isArray(urls) && typeof urls[index] === "string" ? urls[index] : null;
}
