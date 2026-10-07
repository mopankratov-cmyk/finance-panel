import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { shiftIsoDay } from "@/lib/sync/moscowDay";
import { rowsByIds } from "./byIds";
import { CHINA_NICHES, CHINA_NICHES_VERSION, CHINA_STOP_WORDS, chinaKeyConfigured, parseRefKey, type ChinaBrand } from "./china1688";
import { CHINA_MIGRATION, CHINA_TRENDS_AUTH_WORDS, chinaConfig, chinaKeyRejected, chinaTrendsKeyRejected, chinaWeekOf, loadChinaState, type ChinaState } from "./chinaSync";
import type { AccessStatus, AssortmentDirection } from "./constants";
import { isMissingAssortmentSchema } from "./errors";
import type { NumberKind } from "./socialReelsStore";

/**
 * «Китай (1688)» — чтение для экрана раздела (Куртки / Сумки). Только то, что записал недельный снимок: карточки топа ниш без цен и без
 * продавцов, копии по номерам товаров брендов, тренды ключей и «возможности». Неделя к неделе: «новое в топе» — карточки, которых не было
 * в прошлом снимке этой ниши в пределах его глубины (глубже прошлый снимок не смотрел — там сравнивать не с чем); «поднялось» — позиция в
 * выдаче 1688 выросла не меньше чем на ROSE_MIN_POSITIONS.
 *
 * Без ключа ALI_1688_AK, без миграции, с ключом, отвергнутым поиском 1688, или до первого снимка блок скрыт — причина одной строкой. Это
 * наблюдение рынка 1688, а не решение о закупке.
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
  /** Разных продавцов в топе ниши — наш подсчёт по карточкам 1688 после отсева рекламы, мужского и детского. */
  sellers: "calc",
  /** Новинка — по номеру карточки (номера растут со временем). */
  isNew: "estimate",
  /** «新款» в названии — заявление продавца. */
  claimsNew: "hypothesis",
  /** «Новое в топе», «поднялось». */
  change: "calc",
  /** Копии по номеру: поиск смысловой, полнота 6–8% — нижняя граница. */
  copies: "estimate",
  copiesSellers: "estimate",
  /** Прирост копий к прошлому снимку номера (того же запроса). */
  copiesDelta: "calc",
  /** Покупателей в день по ключу (ряд с отставанием 5–6 недель); ключ без «女» — все покупатели, не только женское. */
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
  /** Ключ без «女»: число — по всем покупателям ключа, не только женское (ключ тренда — не длиннее 5 иероглифов). */
  allBuyers: boolean;
}

export interface ChinaNicheBlock {
  key: string;
  direction: AssortmentDirection;
  ru: string;
  zh: string;
  clerin: boolean;
  observedOn: string;
  previousOn: string | null;
  /**
   * Глубина сравнения: прошлый снимок ниши доставал только до этого места выдачи, а нынешний — глубже (неполная страница 1688, другой
   * потолок топа). Карточки ниже — без «новое в топе»: сравнивать не с чем. null — глубины совпадают или сравнения нет.
   */
  comparedDepth: number | null;
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
  /** Прошлый снимок номера ТОГО ЖЕ запроса (направление входит в запрос); бывает на 2–3 недели старше — подпись «с ДД.ММ». */
  previousOn: string | null;
  /** Прирост карточек с номером к previousOn; null — прошлого снимка того же запроса нет. */
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

/** Глубина снимка ниши — самое глубокое место выдачи среди его строк (позиция — по выдаче 1688, с рекламой и отсеянным). */
export function topDepth(rows: ReadonlyArray<{ rank: number }>): number {
  let depth = 0;
  for (const r of rows) {
    const rank = Number(r.rank);
    if (Number.isFinite(rank) && rank > depth) depth = rank;
  }
  return depth;
}

/**
 * Неделя к неделе по позиции в выдаче: нет в прошлом топе — «новое», но только в пределах глубины прошлого снимка (1688 вернул неполную
 * страницу или потолок топа был меньше — ниже его последнего места сравнивать не с чем, change = null); позиция выросла на
 * ROSE_MIN_POSITIONS и больше — «поднялось»; упала на столько же — «опустилось» (обе позиции известны — и ниже глубины); иначе — «как было».
 * Прошлого снимка нет — null у всех.
 */
export function compareTop(
  current: ReadonlyArray<{ offer_id: string; rank: number }>,
  previous: ReadonlyArray<{ offer_id: string; rank: number }> | null,
  minRise = ROSE_MIN_POSITIONS,
): Map<string, ChinaChange | null> {
  const out = new Map<string, ChinaChange | null>();
  if (!previous || previous.length === 0) {
    for (const r of current) out.set(r.offer_id, null);
    return out;
  }
  const before = new Map(previous.map((r) => [r.offer_id, Number(r.rank)]));
  const depth = topDepth(previous);
  for (const r of current) {
    const from = before.get(r.offer_id);
    const to = Number(r.rank);
    if (from == null) out.set(r.offer_id, to <= depth ? { kind: "new" } : null);
    else if (from - to >= minRise) out.set(r.offer_id, { kind: "rose", from, to });
    else if (to - from >= minRise) out.set(r.offer_id, { kind: "fell", from, to });
    else out.set(r.offer_id, { kind: "same" });
  }
  return out;
}

const articleDirection = (value: string | null | undefined): AssortmentDirection | null => (value === "jackets" || value === "bags" ? value : null);

/**
 * Копии по номерам: последний снимок номера и прирост к прошлому снимку ТОГО ЖЕ запроса. Направление входит в запрос («ZA 8372288 外套 女»
 * против «ZA 8372288 女»): сменилось направление лучшего рилса — это другая выдача, прирост к ней не считается.
 */
export function articleCards(rows: ReadonlyArray<ArticleRow>): ChinaArticleCard[] {
  const byRef = new Map<string, ArticleRow[]>();
  for (const r of rows) (byRef.get(r.ref_key) ?? byRef.set(r.ref_key, []).get(r.ref_key)!).push(r);
  const out: ChinaArticleCard[] = [];
  for (const [refKey, list] of byRef) {
    const ref = parseRefKey(refKey);
    if (!ref) continue;
    const sorted = [...list].sort((a, b) => b.observed_on.localeCompare(a.observed_on));
    const latest = sorted[0];
    const direction = articleDirection(latest.direction);
    const previous = sorted.slice(1).find((r) => articleDirection(r.direction) === direction) ?? null;
    const offers = Number(latest.offers) || 0;
    const ids = (Array.isArray(latest.sample_offer_ids) ? latest.sample_offer_ids : []).map(String).filter((id) => /^\d{6,16}$/.test(id));
    out.push({
      refKey,
      brand: ref.brand,
      number: ref.number,
      direction,
      observedOn: latest.observed_on,
      offers,
      sellers: Number(latest.sellers) || 0,
      previousOn: previous?.observed_on ?? null,
      delta: previous ? offers - (Number(previous.offers) || 0) : null,
      sampleUrls: [...new Set(ids)].slice(0, 5).map(offerUrl),
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
      lastMonth: series.length ? series[series.length - 1].month : null, top1Pct: num(v.top1), top3Pct: num(v.top3), allBuyers: !keyword.includes("女"),
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
    const previousDepth = previous ? topDepth(previous) : null;
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
      direction: niche.direction,
      ru: niche.ru,
      zh: niche.zh[0],
      clerin: niche.clerin === true,
      observedOn: latestOn,
      previousOn,
      comparedDepth: previousDepth != null && topDepth(current) > previousDepth ? previousDepth : null,
      sellers: current[0]?.sellers == null ? null : Number(current[0].sellers),
      offers: cards,
      newInTop: cards.filter((c) => c.change?.kind === "new").length,
      rose: cards.filter((c) => c.change?.kind === "rose").length,
      market,
    });
  }
  return blocks;
}

/** «Возможности» раздела — последний снимок каждого списка; темы другого раздела не попадают (и при чтении всех разделов разом). */
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

/** Строка состояния: лимит 1688, ключ не принят сервисом трендов, снимок недели ещё идёт; null — всё в порядке. */
export function chinaStatusLine(state: ChinaState | null, week: string, latestOn: string | null): string | null {
  const lines: string[] = [];
  if (state?.stop?.reason === "rate_limit") lines.push(CHINA_STOP_WORDS.rate_limit);
  if (chinaTrendsKeyRejected(state?.stop)) lines.push(CHINA_TRENDS_AUTH_WORDS);
  if (latestOn && latestOn < week && !(state?.week === week && state.completedAt)) {
    lines.push(`снимок недели с ${week.split("-").reverse().join(".")} ещё снимается — показан снимок с ${latestOn.split("-").reverse().join(".")}`);
  }
  return lines.length > 0 ? lines.join("; ") : null;
}

/** Причина «блок скрыт» без миграции. */
export const CHINA_MIGRATION_REASON = `таблицы «Китай (1688)» не созданы — нужна миграция ${CHINA_MIGRATION}`;
/** Причина «блок скрыт» до первого снимка раздела. */
export const CHINA_NO_SNAPSHOT_REASON = "первого недельного снимка 1688 ещё нет";

const OFFER_COLUMNS = "niche_key,direction,observed_on,rank,offer_id,title_zh,title_ru,image_url,category,sold_text,sold_min,orders_30d,sellers,is_new,tags";
const ARTICLE_COLUMNS = "ref_key,observed_on,direction,offers,sellers,sample_offer_ids";

/** Карточки топа ниш с `since` (раздел или оба) — листанием: строк недели бывает больше 1 000. */
function readOffers(db: SupabaseClient, since: string, direction: AssortmentDirection | null): Promise<OfferRow[]> {
  return loadAllSupabasePages<OfferRow>((from, to) => {
    const query = db.from(OFFERS).select(OFFER_COLUMNS).gte("observed_on", since);
    return (direction ? query.eq("direction", direction) : query)
      .order("observed_on", { ascending: true }).order("niche_key", { ascending: true }).order("offer_id", { ascending: true }).range(from, to) as unknown as Page<OfferRow>;
  }, { label: "Китай (1688): топ ниш" });
}

function readArticles(db: SupabaseClient, since: string): Promise<ArticleRow[]> {
  return loadAllSupabasePages<ArticleRow>((from, to) => db.from(ARTICLES).select(ARTICLE_COLUMNS).gte("observed_on", since)
    .order("ref_key", { ascending: true }).order("observed_on", { ascending: true }).range(from, to) as unknown as Page<ArticleRow>, { label: "Китай (1688): копии по номерам" });
}

const readSince = (nowMs: number) => shiftIsoDay(chinaWeekOf(nowMs), -7 * (CHINA_READ_WEEKS - 1));

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
  const since = readSince(nowMs);
  let offers: OfferRow[];
  let articles: ArticleRow[];
  let trends: TrendRow[];
  try {
    [offers, articles, trends] = await Promise.all([
      readOffers(db, since, options.direction),
      readArticles(db, since),
      loadAllSupabasePages<TrendRow>((from, to) => db.from(TRENDS)
        .select("list_key,observed_on,rank,keyword_zh,keyword_ru,value_text,direction").eq("direction", options.direction).gte("observed_on", since)
        .order("list_key", { ascending: true }).order("observed_on", { ascending: true }).order("rank", { ascending: true }).range(from, to) as unknown as Page<TrendRow>, { label: "Китай (1688): тренды" }),
    ]);
  } catch (error) {
    if (missing(error)) return { available: false, reason: CHINA_MIGRATION_REASON };
    throw error;
  }
  const loaded = await loadChinaState(db).catch(() => null);
  const state = loaded?.state ?? null;
  if (chinaKeyRejected(state?.stop)) return { available: false, reason: CHINA_STOP_WORDS.auth };
  const niches = buildNicheBlocks(options.direction, offers, trends);
  if (niches.length === 0) {
    const running = state?.week === week && !state.completedAt;
    return { available: false, reason: running ? "первый недельный снимок 1688 снимается — блок появится, когда он запишется" : CHINA_NO_SNAPSHOT_REASON };
  }
  const latestOn = niches.reduce<string | null>((max, n) => (max == null || n.observedOn > max ? n.observedOn : max), null);
  return {
    available: true,
    direction: options.direction,
    week,
    version: CHINA_NICHES_VERSION,
    status: chinaStatusLine(state, week, latestOn),
    niches,
    // Сначала последний снимок номера (и прирост к тому же запросу), потом раздел: старый снимок номера под другим разделом не всплывает.
    articles: articleCards(articles).filter((a) => a.direction == null || a.direction === options.direction),
    opportunities: buildOpportunities(options.direction, trends),
    kinds: CHINA_NUMBER_KINDS,
    disclaimer: CHINA_DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// Вкладка раздела: есть, только когда таблицы есть и снимок раздела записан

export type ChinaTab = { visible: false; reason: string } | { visible: true; reason: null };

/**
 * Видна ли вкладка «Китай (1688)» в разделе — без чтения всего снимка: ключ, таблицы, хоть одна карточка топа раздела за окно чтения и
 * ключ не отвергнут 1688. Не видна — причина одной строкой (экран её показывает, только если вкладку открыли по адресу).
 */
export async function loadChinaTab(db: SupabaseClient, options: LoadChinaOptions): Promise<ChinaTab> {
  const env = options.env ?? process.env;
  if (!chinaKeyConfigured(env)) return { visible: false, reason: CHINA_STOP_WORDS.no_key };
  const { data, error } = await db.from(OFFERS).select("observed_on").eq("direction", options.direction).gte("observed_on", readSince(options.nowMs ?? Date.now())).limit(1);
  if (error) {
    if (missing(error)) return { visible: false, reason: CHINA_MIGRATION_REASON };
    throw new Error(error.message);
  }
  if (!data || data.length === 0) return { visible: false, reason: CHINA_NO_SNAPSHOT_REASON };
  const loaded = await loadChinaState(db).catch(() => null);
  if (chinaKeyRejected(loaded?.state.stop)) return { visible: false, reason: CHINA_STOP_WORDS.auth };
  return { visible: true, reason: null };
}

// ---------------------------------------------------------------------------
// «Ставка фабрик» в карточке рилса: копии номера на 1688 и прирост за неделю

export interface ChinaRefCopies {
  refKey: string;
  /** Карточек 1688 с номером в названии (поиск смысловой, полнота 6–8%) — оценка, нижняя граница. */
  offers: number;
  sellers: number;
  /** Прирост к прошлому снимку номера — расчёт; null — прошлого снимка нет. */
  delta: number | null;
  observedOn: string;
  previousOn: string | null;
}

/**
 * Копии номеров товаров (refs рилсов «zara:…» / «uniqlo:…») по последнему снимку и прирост к прошлому. null — строки нет вовсе: ключа нет,
 * таблиц нет или ключ отвергнут 1688 (как и блок раздела). Номеров много — чтение пачками по id с листанием.
 */
export async function loadChinaCopies(db: SupabaseClient, refKeys: readonly string[], options: { nowMs?: number; env?: Record<string, string | undefined> } = {}): Promise<Record<string, ChinaRefCopies> | null> {
  const env = options.env ?? process.env;
  if (!chinaKeyConfigured(env)) return null;
  const keys = [...new Set(refKeys.map((k) => parseRefKey(String(k))?.key).filter((k): k is string => Boolean(k)))].sort();
  if (keys.length === 0) return {};
  const since = readSince(options.nowMs ?? Date.now());
  let rows: ArticleRow[];
  try {
    rows = await rowsByIds<ArticleRow>(keys, "Китай (1688): копии по номерам рилсов", (part, from, to) => db.from(ARTICLES).select(ARTICLE_COLUMNS)
      .in("ref_key", part).gte("observed_on", since).order("ref_key", { ascending: true }).order("observed_on", { ascending: true }).range(from, to) as unknown as Page<ArticleRow>);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  if (rows.length === 0) return {};
  const loaded = await loadChinaState(db).catch(() => null);
  if (chinaKeyRejected(loaded?.state.stop)) return null;
  const out: Record<string, ChinaRefCopies> = {};
  for (const c of articleCards(rows)) out[c.refKey] = { refKey: c.refKey, offers: c.offers, sellers: c.sellers, delta: c.delta, observedOn: c.observedOn, previousOn: c.previousOn };
  return out;
}

// ---------------------------------------------------------------------------
// Воскресная сводка: новое в топе ниш и рост копий по номерам из рилсов

export const CHINA_DIGEST_MAX_ITEMS = 5;
export const CHINA_DIGEST_MAX_GROWTH = 5;

export interface ChinaDigestItem {
  direction: AssortmentDirection;
  niche: string;
  title: string;
  rank: number;
  url: string;
}

export interface ChinaDigestGrowth {
  refKey: string;
  brand: ChinaBrand;
  number: string;
  offers: number;
  delta: number;
  /** Снимок номера, к которому считан прирост (того же запроса): не всегда ровно неделя назад. */
  previousOn: string;
  observedOn: string;
}

export interface ChinaDigest {
  /** Неделя снимка (понедельник). */
  week: string;
  /** До CHINA_DIGEST_MAX_ITEMS «новых в топе» — по одной лучшей карточке ниши по кругу, ниши с бо́льшим числом новых — первыми. */
  items: ChinaDigestItem[];
  /** «Новых в топе» всего и в скольких нишах (снимок недели против прошлого снимка ниши). */
  newTotal: number;
  niches: number;
  /** Номера, у которых копий на 1688 за неделю стало больше. */
  growth: ChinaDigestGrowth[];
  /** Раздел не загрузился — строкой в сводке. */
  error?: string;
}

/**
 * Раздел сводки из блоков ниш обоих разделов и копий по номерам (чистая функция): только снимок ЭТОЙ недели против прошлого снимка ниши
 * (до сравнения — ни «нового», ни роста) и только рост копий. Нечего сказать — null (раздела в сводке нет).
 */
export function pickChinaDigest(week: string, blocks: readonly ChinaNicheBlock[], articles: readonly ChinaArticleCard[]): ChinaDigest | null {
  const compared = blocks.filter((b) => b.observedOn === week && b.previousOn != null && b.newInTop > 0)
    .sort((a, b) => b.newInTop - a.newInTop || a.key.localeCompare(b.key));
  const queues = compared.map((b) => b.offers.filter((o) => o.change?.kind === "new").sort((x, y) => x.rank - y.rank).map((o): ChinaDigestItem => ({
    direction: b.direction, niche: b.ru, title: o.titleRu?.trim() || o.titleZh, rank: o.rank, url: o.url,
  })));
  const items: ChinaDigestItem[] = [];
  for (let round = 0; items.length < CHINA_DIGEST_MAX_ITEMS && queues.some((q) => q.length > round); round += 1) {
    for (const q of queues) {
      if (items.length >= CHINA_DIGEST_MAX_ITEMS) break;
      if (q[round]) items.push(q[round]);
    }
  }
  const growth = articles.filter((a) => a.observedOn === week && a.delta != null && a.delta > 0)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0) || b.offers - a.offers || a.refKey.localeCompare(b.refKey))
    .slice(0, CHINA_DIGEST_MAX_GROWTH)
    .map((a): ChinaDigestGrowth => ({ refKey: a.refKey, brand: a.brand, number: a.number, offers: a.offers, delta: a.delta ?? 0, previousOn: a.previousOn ?? a.observedOn, observedOn: a.observedOn }));
  if (items.length === 0 && growth.length === 0) return null;
  return { week, items, newTotal: compared.reduce((n, b) => n + b.newInTop, 0), niches: compared.length, growth };
}

/** Раздел сводки «Китай (1688)»: null — ключа или таблиц нет, ключ отвергнут или за неделю нечего сказать. */
export async function loadChinaDigest(db: SupabaseClient, options: { nowMs: number; env?: Record<string, string | undefined> }): Promise<ChinaDigest | null> {
  const env = options.env ?? process.env;
  if (!chinaKeyConfigured(env)) return null;
  const since = readSince(options.nowMs);
  let offers: OfferRow[];
  let articles: ArticleRow[];
  try {
    [offers, articles] = await Promise.all([readOffers(db, since, null), readArticles(db, since)]);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  if (offers.length === 0 && articles.length === 0) return null;
  const loaded = await loadChinaState(db).catch(() => null);
  if (chinaKeyRejected(loaded?.state.stop)) return null;
  const blocks = (["bags", "jackets"] as const).flatMap((d) => buildNicheBlocks(d, offers, []));
  return pickChinaDigest(chinaWeekOf(options.nowMs), blocks, articleCards(articles));
}

// ---------------------------------------------------------------------------
// Экран «Источники»: строка 1688 (S104) — подключён, нет ключа, последний снимок

export interface ChinaSourceFacts {
  enabled: boolean;
  keyConfigured: boolean;
  migrationMissing: boolean;
  /** Неделя последнего снимка топа ниш (любой раздел); null — снимков нет. */
  latestOn: string | null;
  /** Ниш в последнем снимке. */
  niches: number;
  stop: ChinaState["stop"];
}

const dmy = (iso: string) => iso.split("-").reverse().join(".");

/**
 * Статус S104 для экрана «Источники» — по факту, а не по паспорту этапа 0 («Кандидат; доступ не проверен»): выключен, нет ключа, нет
 * миграции, ключ отвергнут поиском, снимка ещё нет, свежий снимок (эта или прошлая неделя) или давно не снимался; ключ не принят только
 * сервисом трендов — «Частично» с причиной. Чистая функция.
 */
export function chinaSourceView(facts: ChinaSourceFacts, nowMs: number): { accessStatus: AccessStatus; accessNote: string } {
  const manual = "Вручную — страница «Китайские площадки — ссылки».";
  if (!facts.enabled) return { accessStatus: "disabled", accessNote: `«Китай (1688)» выключен настройкой ASSORTMENT_CHINA=off: 1688 не спрашиваем. ${manual}` };
  if (!facts.keyConfigured) return { accessStatus: "not_connected", accessNote: `1688: нет ключа — задайте ALI_1688_AK (выдаётся на clawhub.1688.com); недельный снимок не снимается. ${manual}` };
  if (facts.migrationMissing) return { accessStatus: "partial", accessNote: `1688: ключ задан, но таблиц снимка нет — нужна миграция ${CHINA_MIGRATION}.` };
  if (chinaKeyRejected(facts.stop)) return { accessStatus: "unavailable", accessNote: `1688: ${CHINA_STOP_WORDS.auth} — перевыпустите ключ на clawhub.1688.com; вкладка «Китай (1688)» скрыта.` };
  const limit = facts.stop?.reason === "rate_limit" ? `; ${CHINA_STOP_WORDS.rate_limit}` : "";
  // Ключ не принят только сервисом трендов: топ ниш и копии снимаются, но источник работает не целиком — «Частично», не «проверен».
  const trendsOff = chinaTrendsKeyRejected(facts.stop);
  const trends = trendsOff ? `; ${CHINA_TRENDS_AUTH_WORDS} — проверьте права ключа на clawhub.1688.com` : "";
  if (!facts.latestOn) return { accessStatus: "partial", accessNote: `1688 подключён (официальные навыки 1688): первого недельного снимка ещё нет — снимок недели начинается в понедельник${limit}${trends}.` };
  const fresh = facts.latestOn >= shiftIsoDay(chinaWeekOf(nowMs), -7);
  if (!fresh) return { accessStatus: "partial", accessNote: `1688 подключён, но свежего снимка нет: последний — неделя с ${dmy(facts.latestOn)}; смотрите журнал задачи assortment-china${limit}${trends}.` };
  return {
    accessStatus: trendsOff ? "partial" : "auto_verified",
    accessNote: `1688 подключён (официальные навыки 1688): последний снимок — неделя с ${dmy(facts.latestOn)}, ниш ${facts.niches} из ${CHINA_NICHES.length}; вкладка «Китай (1688)» в «Куртках» и «Сумках»${limit}${trends}.`,
  };
}

/** Факты для строки S104: без ключа и выключенный — без чтения базы; сбой чтения — исключение (загрузчик паспорта его глотает). */
export async function loadChinaSourceFacts(db: SupabaseClient, options: { env?: Record<string, string | undefined> } = {}): Promise<ChinaSourceFacts> {
  const env = options.env ?? process.env;
  const base: ChinaSourceFacts = { enabled: chinaConfig(env).enabled, keyConfigured: chinaKeyConfigured(env), migrationMissing: false, latestOn: null, niches: 0, stop: null };
  if (!base.enabled || !base.keyConfigured) return base;
  const { data, error } = await db.from(OFFERS).select("observed_on").order("observed_on", { ascending: false }).limit(1);
  if (error) {
    if (missing(error)) return { ...base, migrationMissing: true };
    throw new Error(error.message);
  }
  const latestOn = (data?.[0] as { observed_on?: string } | undefined)?.observed_on ?? null;
  const [niches, loaded] = await Promise.all([
    latestOn
      ? loadAllSupabasePages<{ niche_key: string }>((from, to) => db.from(OFFERS).select("niche_key").eq("observed_on", latestOn)
        .order("niche_key", { ascending: true }).order("offer_id", { ascending: true }).range(from, to) as unknown as Page<{ niche_key: string }>, { label: "Китай (1688): ниши снимка" })
      : Promise.resolve([]),
    loadChinaState(db).catch(() => null),
  ]);
  return { ...base, latestOn, niches: new Set(niches.map((r) => r.niche_key)).size, stop: loaded?.state.stop ?? null };
}
