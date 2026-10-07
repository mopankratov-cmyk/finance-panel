import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { shiftIsoDay } from "@/lib/sync/moscowDay";
import { CHINA_NICHES, CHINA_NICHES_VERSION, CHINA_STOP_WORDS, chinaKeyConfigured, parseRefKey, type ChinaBrand } from "./china1688";
import { CHINA_MIGRATION, chinaWeekOf, loadChinaState, type ChinaState } from "./chinaSync";
import type { AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema } from "./errors";
import type { NumberKind } from "./socialReelsStore";

/**
 * «Китай (1688)» — чтение для экрана раздела (Куртки / Сумки). Только то, что записал недельный снимок: карточки топа ниш без цен и без
 * продавцов, копии по номерам товаров брендов, тренды ключей и «возможности». Неделя к неделе: «новое в топе» — карточки, которых не было
 * в прошлом снимке этой ниши; «поднялось» — позиция в выдаче 1688 выросла не меньше чем на ROSE_MIN_POSITIONS.
 *
 * Без ключа ALI_1688_AK, без миграции, с недействительным ключом или до первого снимка блок скрыт — причина одной строкой. Это наблюдение
 * рынка 1688, а не решение о закупке.
 */

const OFFERS = "assortment_cn_offer_snapshot";
const ARTICLES = "assortment_cn_article_snapshot";
const TRENDS = "assortment_cn_trend_snapshot";

/** Сколько недель назад читать (текущая + три прошлых: сравнение берёт ближайший прошлый снимок ниши). */
export const CHINA_READ_WEEKS = 4;
/** «Поднялось» — позиция выросла хотя бы на столько (на 1–2 места выдача гуляет сама). */
export const ROSE_MIN_POSITIONS = 3;

export const CHINA_DISCLAIMER = "Наблюдение рынка 1688, а не решение о закупке: цены и продавцов не храним и не показываем.";

/** Метки чисел блока: факт 1688, расчёт, оценка, гипотеза. */
export const CHINA_NUMBER_KINDS = {
  /** Счётчик продаж 1688 — накопленный и округлённый, нижняя граница. */
  soldMin: "fact",
  /** Оплаченные заказы за 30 дней. */
  orders30d: "fact",
  /** Разных продавцов в топе ниши. */
  sellers: "fact",
  /** Новинка — по номеру карточки (номера растут со временем). */
  isNew: "estimate",
  /** «新款» в названии — заявление продавца. */
  claimsNew: "hypothesis",
  /** «Новое в топе», «поднялось». */
  change: "calc",
  /** Копии по номеру: поиск смысловой, полнота 6–8% — нижняя граница. */
  copies: "estimate",
  copiesSellers: "estimate",
  /** Прирост копий за неделю. */
  copiesDelta: "calc",
  /** Покупателей в день по ключу (ряд с отставанием 5–6 недель). */
  marketBuyers: "fact",
  /** Изменение к прошлому году — расчёт 1688. */
  marketYoy: "calc",
  /** «Возможности» за последний час — свежесть сомнительна. */
  opportunities: "hypothesis",
} as const satisfies Record<string, NumberKind>;

export type ChinaChange = { kind: "new" } | { kind: "rose"; from: number; to: number } | { kind: "fell"; from: number; to: number } | { kind: "same" };

export interface ChinaOfferCard {
  offerId: string;
  /** Карточка на 1688 (строится по номеру, адрес не хранится). */
  url: string;
  rank: number;
  titleZh: string;
  titleRu: string | null;
  imageUrl: string | null;
  category: string | null;
  soldText: string | null;
  soldMin: number | null;
  orders30d: number | null;
  isNew: boolean;
  badges: string[];
  traits: string[];
  /** null — прошлого снимка ниши нет, сравнивать не с чем. */
  change: ChinaChange | null;
}

export interface ChinaMarket {
  observedOn: string;
  keyword: string;
  buyersPerDay: number | null;
  supplyPerDay: number | null;
  ratio: number | null;
  yoyPct: number | null;
  series: Array<{ month: string; value: number }>;
  lastMonth: string | null;
  top1Pct: number | null;
  top3Pct: number | null;
}

export interface ChinaNicheBlock {
  key: string;
  ru: string;
  zh: string;
  clerin: boolean;
  observedOn: string;
  previousOn: string | null;
  sellers: number | null;
  offers: ChinaOfferCard[];
  newInTop: number;
  rose: number;
  market: ChinaMarket | null;
}

export interface ChinaArticleCard {
  refKey: string;
  brand: ChinaBrand;
  number: string;
  direction: AssortmentDirection | null;
  observedOn: string;
  offers: number;
  sellers: number;
  previousOn: string | null;
  /** Прирост карточек с номером за неделю; null — прошлого снимка нет. */
  delta: number | null;
  sampleUrls: string[];
}

export interface ChinaOpportunity {
  listKey: string;
  platform: string;
  section: string;
  rank: number;
  topic: string;
  topicRu: string | null;
  count: string | null;
  isUp: boolean | null;
  words: Array<{ word: string; growthPct: number | null }>;
  observedOn: string;
}

export type ChinaView =
  | { available: false; reason: string }
  | {
    available: true;
    direction: AssortmentDirection;
    week: string;
    version: string;
    /** Строка состояния (лимит 1688, снимок недели ещё идёт); null — всё в порядке. */
    status: string | null;
    niches: ChinaNicheBlock[];
    articles: ChinaArticleCard[];
    opportunities: ChinaOpportunity[];
    kinds: typeof CHINA_NUMBER_KINDS;
    disclaimer: string;
  };

export const offerUrl = (offerId: string) => `https://detail.1688.com/offer/${offerId}.html`;

/**
 * Неделя к неделе по позиции в выдаче: нет в прошлом топе — «новое»; позиция выросла на ROSE_MIN_POSITIONS и больше — «поднялось»;
 * упала на столько же — «опустилось»; иначе — «как было». Прошлого снимка нет — null у всех.
 */
export function compareTop(
  current: ReadonlyArray<{ offer_id: string; rank: number }>,
  previous: ReadonlyArray<{ offer_id: string; rank: number }> | null,
  minRise = ROSE_MIN_POSITIONS,
): Map<string, ChinaChange | null> {
  const out = new Map<string, ChinaChange | null>();
  if (!previous) {
    for (const r of current) out.set(r.offer_id, null);
    return out;
  }
  const before = new Map(previous.map((r) => [r.offer_id, Number(r.rank)]));
  for (const r of current) {
    const from = before.get(r.offer_id);
    const to = Number(r.rank);
    if (from == null) out.set(r.offer_id, { kind: "new" });
    else if (from - to >= minRise) out.set(r.offer_id, { kind: "rose", from, to });
    else if (to - from >= minRise) out.set(r.offer_id, { kind: "fell", from, to });
    else out.set(r.offer_id, { kind: "same" });
  }
  return out;
}

/** Копии по номерам: последний снимок номера и прирост к прошлому. */
export function articleCards(rows: ReadonlyArray<ArticleRow>): ChinaArticleCard[] {
  const byRef = new Map<string, ArticleRow[]>();
  for (const r of rows) (byRef.get(r.ref_key) ?? byRef.set(r.ref_key, []).get(r.ref_key)!).push(r);
  const out: ChinaArticleCard[] = [];
  for (const [refKey, list] of byRef) {
    const ref = parseRefKey(refKey);
    if (!ref) continue;
    const sorted = [...list].sort((a, b) => b.observed_on.localeCompare(a.observed_on));
    const [latest, previous] = sorted;
    const offers = Number(latest.offers) || 0;
    out.push({
      refKey,
      brand: ref.brand,
      number: ref.number,
      direction: latest.direction === "jackets" || latest.direction === "bags" ? latest.direction : null,
      observedOn: latest.observed_on,
      offers,
      sellers: Number(latest.sellers) || 0,
      previousOn: previous?.observed_on ?? null,
      delta: previous ? offers - (Number(previous.offers) || 0) : null,
      sampleUrls: (Array.isArray(latest.sample_offer_ids) ? latest.sample_offer_ids : []).filter((id) => /^\d{6,16}$/.test(String(id))).slice(0, 5).map((id) => offerUrl(String(id))),
    });
  }
  return out.sort((a, b) => b.offers - a.offers || (b.delta ?? 0) - (a.delta ?? 0) || a.refKey.localeCompare(b.refKey));
}

/** value_text тренда ключа → числа; не JSON или без чисел — null. */
export function parseMarketValue(text: string | null | undefined, observedOn: string, keyword: string): ChinaMarket | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    const series = (Array.isArray(v.series) ? v.series : [])
      .filter((p): p is [string, number] => Array.isArray(p) && typeof p[0] === "string" && /^20\d{4}$/.test(p[0]) && typeof p[1] === "number")
      .map(([month, value]) => ({ month, value }));
    const market: ChinaMarket = {
      observedOn, keyword, buyersPerDay: num(v.buyers), supplyPerDay: num(v.supply), ratio: num(v.ratio), yoyPct: num(v.yoy), series,
      lastMonth: series.length ? series[series.length - 1].month : null, top1Pct: num(v.top1), top3Pct: num(v.top3),
    };
    return market.buyersPerDay == null && series.length === 0 ? null : market;
  } catch {
    return null;
  }
}

interface OfferRow {
  niche_key: string;
  direction: string;
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
  is_new: boolean | null;
  tags: string[] | null;
}

interface ArticleRow {
  ref_key: string;
  observed_on: string;
  direction: string | null;
  offers: number;
  sellers: number;
  sample_offer_ids: string[] | null;
}

interface TrendRow {
  list_key: string;
  observed_on: string;
  rank: number;
  keyword_zh: string;
  keyword_ru: string | null;
  value_text: string | null;
  direction: string | null;
}

type Page<Row> = PromiseLike<{ data: Row[] | null; error: { message: string; code?: string } | null }>;

function missing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error ?? "");
  return code === "42P01" || code === "PGRST205" || isMissingAssortmentSchema(new Error(message));
}

const BADGES = new Set(["yx", "inspected", "claims_new", "unisex"]);

/** Собрать блоки ниш раздела из строк снимков (чистая функция). */
export function buildNicheBlocks(direction: AssortmentDirection, offers: readonly OfferRow[], trends: readonly TrendRow[]): ChinaNicheBlock[] {
  const blocks: ChinaNicheBlock[] = [];
  for (const niche of CHINA_NICHES) {
    if (niche.direction !== direction) continue;
    const rows = offers.filter((r) => r.niche_key === niche.key);
    if (rows.length === 0) continue;
    const dates = [...new Set(rows.map((r) => r.observed_on))].sort().reverse();
    const [latestOn, previousOn = null] = dates;
    const current = rows.filter((r) => r.observed_on === latestOn).sort((a, b) => Number(a.rank) - Number(b.rank));
    const previous = previousOn ? rows.filter((r) => r.observed_on === previousOn) : null;
    const changes = compareTop(current, previous);
    const cards: ChinaOfferCard[] = current.map((r) => {
      const tags = Array.isArray(r.tags) ? r.tags.map(String) : [];
      return {
        offerId: r.offer_id,
        url: offerUrl(r.offer_id),
        rank: Number(r.rank),
        titleZh: r.title_zh,
        titleRu: r.title_ru ?? null,
        imageUrl: r.image_url ?? null,
        category: r.category ?? null,
        soldText: r.sold_text ?? null,
        soldMin: r.sold_min == null ? null : Number(r.sold_min),
        orders30d: r.orders_30d == null ? null : Number(r.orders_30d),
        isNew: r.is_new === true,
        badges: tags.filter((t) => BADGES.has(t)),
        traits: tags.filter((t) => t.startsWith("cpv:")).map((t) => t.slice(4)),
        change: changes.get(r.offer_id) ?? null,
      };
    });
    const marketRows = trends.filter((t) => t.list_key === `market:${niche.key}`).sort((a, b) => b.observed_on.localeCompare(a.observed_on));
    const market = marketRows.length ? parseMarketValue(marketRows[0].value_text, marketRows[0].observed_on, marketRows[0].keyword_zh) : null;
    blocks.push({
      key: niche.key,
      ru: niche.ru,
      zh: niche.zh[0],
      clerin: niche.clerin === true,
      observedOn: latestOn,
      previousOn,
      sellers: current[0]?.sellers == null ? null : Number(current[0].sellers),
      offers: cards,
      newInTop: cards.filter((c) => c.change?.kind === "new").length,
      rose: cards.filter((c) => c.change?.kind === "rose").length,
      market,
    });
  }
  return blocks;
}

/** «Возможности» раздела — последний снимок каждого списка. */
export function buildOpportunities(direction: AssortmentDirection, trends: readonly TrendRow[]): ChinaOpportunity[] {
  const rows = trends.filter((t) => t.list_key.startsWith("opportunity:") && t.direction === direction);
  const latestByList = new Map<string, string>();
  for (const r of rows) if (!latestByList.has(r.list_key) || r.observed_on > latestByList.get(r.list_key)!) latestByList.set(r.list_key, r.observed_on);
  return rows.filter((r) => latestByList.get(r.list_key) === r.observed_on).map((r) => {
    const [, platform = "", section = ""] = r.list_key.split(":");
    let value: { count?: unknown; isUp?: unknown; words?: unknown } = {};
    try {
      value = r.value_text ? (JSON.parse(r.value_text) as typeof value) : {};
    } catch {
      value = {};
    }
    const words = (Array.isArray(value.words) ? value.words : [])
      .filter((w): w is { word: string; growthPct?: unknown } => Boolean(w) && typeof (w as { word?: unknown }).word === "string")
      .map((w) => ({ word: w.word, growthPct: typeof w.growthPct === "number" ? w.growthPct : null }));
    return {
      listKey: r.list_key, platform, section, rank: Number(r.rank), topic: r.keyword_zh, topicRu: r.keyword_ru ?? null,
      count: typeof value.count === "string" ? value.count : null, isUp: typeof value.isUp === "boolean" ? value.isUp : null, words, observedOn: r.observed_on,
    };
  }).sort((a, b) => a.listKey.localeCompare(b.listKey) || a.rank - b.rank);
}

/** Строка состояния: лимит 1688 или снимок недели ещё идёт. */
export function chinaStatusLine(state: ChinaState | null, week: string, latestOn: string | null): string | null {
  if (state?.stop?.reason === "rate_limit") return CHINA_STOP_WORDS.rate_limit;
  if (latestOn && latestOn < week && !(state?.week === week && state.completedAt)) {
    return `снимок недели с ${week.split("-").reverse().join(".")} ещё снимается — показан снимок с ${latestOn.split("-").reverse().join(".")}`;
  }
  return null;
}

export interface LoadChinaOptions {
  direction: AssortmentDirection;
  nowMs?: number;
  env?: Record<string, string | undefined>;
}

/**
 * Блок «Китай (1688)» раздела. Без ключа, без миграции, с недействительным ключом и до первого снимка — { available: false, reason } (блок
 * скрыт, причина одной строкой).
 */
export async function loadChinaView(db: SupabaseClient, options: LoadChinaOptions): Promise<ChinaView> {
  const env = options.env ?? process.env;
  if (!chinaKeyConfigured(env)) return { available: false, reason: CHINA_STOP_WORDS.no_key };
  const nowMs = options.nowMs ?? Date.now();
  const week = chinaWeekOf(nowMs);
  const since = shiftIsoDay(week, -7 * (CHINA_READ_WEEKS - 1));
  let offers: OfferRow[];
  let articles: ArticleRow[];
  let trends: TrendRow[];
  try {
    [offers, articles, trends] = await Promise.all([
      loadAllSupabasePages<OfferRow>((from, to) => db.from(OFFERS)
        .select("niche_key,direction,observed_on,rank,offer_id,title_zh,title_ru,image_url,category,sold_text,sold_min,orders_30d,sellers,is_new,tags")
        .eq("direction", options.direction).gte("observed_on", since)
        .order("observed_on", { ascending: true }).order("niche_key", { ascending: true }).order("offer_id", { ascending: true }).range(from, to) as unknown as Page<OfferRow>, { label: "Китай (1688): топ ниш" }),
      loadAllSupabasePages<ArticleRow>((from, to) => db.from(ARTICLES)
        .select("ref_key,observed_on,direction,offers,sellers,sample_offer_ids").gte("observed_on", since)
        .order("ref_key", { ascending: true }).order("observed_on", { ascending: true }).range(from, to) as unknown as Page<ArticleRow>, { label: "Китай (1688): копии по номерам" }),
      loadAllSupabasePages<TrendRow>((from, to) => db.from(TRENDS)
        .select("list_key,observed_on,rank,keyword_zh,keyword_ru,value_text,direction").eq("direction", options.direction).gte("observed_on", since)
        .order("list_key", { ascending: true }).order("observed_on", { ascending: true }).order("rank", { ascending: true }).range(from, to) as unknown as Page<TrendRow>, { label: "Китай (1688): тренды" }),
    ]);
  } catch (error) {
    if (missing(error)) return { available: false, reason: `таблицы «Китай (1688)» не созданы — нужна миграция ${CHINA_MIGRATION}` };
    throw error;
  }
  const loaded = await loadChinaState(db).catch(() => null);
  const state = loaded?.state ?? null;
  if (state?.stop?.reason === "auth") return { available: false, reason: CHINA_STOP_WORDS.auth };
  const niches = buildNicheBlocks(options.direction, offers, trends);
  if (niches.length === 0) {
    const running = state?.week === week && !state.completedAt;
    return { available: false, reason: running ? "первый недельный снимок 1688 снимается — блок появится, когда он запишется" : "первого недельного снимка 1688 ещё нет" };
  }
  const latestOn = niches.reduce<string | null>((max, n) => (max == null || n.observedOn > max ? n.observedOn : max), null);
  return {
    available: true,
    direction: options.direction,
    week,
    version: CHINA_NICHES_VERSION,
    status: chinaStatusLine(state, week, latestOn),
    niches,
    articles: articleCards(articles.filter((a) => a.direction == null || a.direction === options.direction)),
    opportunities: buildOpportunities(options.direction, trends),
    kinds: CHINA_NUMBER_KINDS,
    disclaimer: CHINA_DISCLAIMER,
  };
}
