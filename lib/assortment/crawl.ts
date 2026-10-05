/**
 * Автообход каталогов Shopify-брендов (этап 2, пункт 4). Чистые функции.
 *
 * Берём из `/products.json` только идентификатор, handle, название, тип, теги,
 * дату публикации, бренд и ссылки на фото — цены и варианты отбрасываются здесь
 * же (граница ТЗ). Первый обход источника — база сравнения: в ленту не пишем
 * ничего, но модели видны в «Каталогах брендов» (ссылки на фото, без копий).
 */

import type { AssortmentDirection } from "./constants";
import type { CatalogBadge } from "./sourceItems";

export interface CatalogItem {
  sourceItemId: string;
  handle: string;
  title: string;
  productType: string;
  tags: string[];
  publishedAt: string | null;
  /** Каталог брендов: ссылки на фото с сайта (до 4), бренд, метки сайта. */
  images?: string[];
  vendor?: string | null;
  badges?: CatalogBadge[];
}

const MAX_ITEM_IMAGES = 4;

const NOT_BADGE = /(^|[^a-z])(not|no|non)[\s_:-]*(new|best)|[:=_-](false|no|0)$/;
const NEW_TAG = /^(new|new[\s_-]?(arrivals?|in|season|collection|product|products)|newproduct|(label|badge|tag|filter)[:_-]new)$|^новинк/;
const BESTSELLER_TAG = /^(best[\s_-]?sell(er|ers|ing)?|(label|badge|tag|filter)[:_-]best[\s_-]?sell\w*|bestsellers?[\s_-][a-z-]+)$|^бестселлер/;

/**
 * Метки сайта по тегам Shopify: «новинка», «бестселлер». Строже, чем разбор
 * одной карточки при импорте: на весь каталог «not-new», «new-false» или
 * «newsletter» дали бы ложные метки.
 */
export function badgesFromTags(tags: string[]): CatalogBadge[] {
  const normalized = tags.map((t) => t.toLowerCase().trim()).filter((t) => t && !NOT_BADGE.test(t));
  const out: CatalogBadge[] = [];
  if (normalized.some((t) => NEW_TAG.test(t))) out.push("new");
  if (normalized.some((t) => BESTSELLER_TAG.test(t))) out.push("bestseller");
  return out;
}

function imageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const image of raw as Array<{ src?: unknown } | string>) {
    const src = typeof image === "string" ? image : typeof image?.src === "string" ? image.src : null;
    if (src && /^https:\/\//.test(src) && !out.includes(src)) out.push(src);
    if (out.length >= MAX_ITEM_IMAGES) break;
  }
  return out;
}

export const CATALOG_PAGE_SIZE = 250;
/**
 * Потолок страниц каталога Shopify. Был 8 (2 000 товаров), и у JW PEI — в каталоге 2 515 товаров (замер 05.10: 10 полных страниц и
 * ещё 15) — обход всегда заканчивался «окном», а «пропало» по источнику (≈45% сумок) определить было нельзя; недосмотренной
 * оставалась пятая часть каталога. Источник, чей каталог короче потолка, останавливается на неполной странице и потолка не касается.
 * 16 (4 000) — запас на рост JW PEI в полтора раза; дальше обход снова скажет «окно», а не промолчит.
 */
export const MAX_CATALOG_PAGES = 16;

export function parseCatalogPage(json: unknown): CatalogItem[] {
  const products = (json as { products?: unknown })?.products;
  if (!Array.isArray(products)) return [];
  const out: CatalogItem[] = [];
  for (const raw of products as Array<Record<string, unknown>>) {
    if (raw?.id == null || typeof raw.handle !== "string") continue;
    const tags = typeof raw.tags === "string" ? raw.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : Array.isArray(raw.tags) ? raw.tags.map(String) : [];
    out.push({
      sourceItemId: String(raw.id),
      handle: raw.handle,
      title: typeof raw.title === "string" ? raw.title.trim() : "",
      productType: typeof raw.product_type === "string" ? raw.product_type.trim() : "",
      tags,
      publishedAt: typeof raw.published_at === "string" ? raw.published_at : null,
      images: imageUrls(raw.images),
      vendor: typeof raw.vendor === "string" && raw.vendor.trim() ? raw.vendor.trim() : null,
      badges: badgesFromTags(tags),
    });
  }
  return out;
}

// \b в JS не видит границ кириллицы — русские основы идут без него.
const BAGS = /\b(bag|bags|handbags?|tote|hobo|clutch|cross-?body|shoulder|satchel|bucket|backpack|baguette|messenger|duffel|weekender|pouch|purse|fanny|sling|wristlet)\b|сумк|клатч|шопер|шоппер|рюкзак|кросс-?боди|тоут|хобо|багет|бананк|саквояж/i;
const NOT_BAGS = /\b(wallet|card ?holder|key ?ring|keychain|charm|strap|belt|scarf|glove|hat|cap|umbrella|socks?)\b|кошел|брелок|ремень|чехол/i;
const JACKETS = /\b(jackets?|coats?|parka|puffer|anorak|trench|bomber|blazer|gilet|vest|windbreaker|shell|outerwear|overshirt|shacket)\b|куртк|пальто|пуховик|ветровк|тренч|плащ|парка|бомбер|жилет|косух|дубл[её]нк|шуб[аы]|анорак|жакет|пиджак|блейзер/i;

/**
 * Главное существительное названия — куртка, сумка или что-то другое. Слова-
 * модификаторы вроде «puffer» или «shoulder» лежат в списках выше и тащили в
 * каталог штаны («Sarna Puffer Pants»), платья («Off-Shoulder Maxi Dress» —
 * сорок три в «сумках» JW PEI), термосы, кружки, чехлы для ноутбука, ремни и
 * юбки. Такой мусор перекосил бы любую долю формы, поэтому решает главное
 * слово, а не любое: «Short coat», «Trench jacket with belt», «Belt Bag»,
 * «Джинсовая куртка» — куртки и сумки.
 *
 * Английский: фраза — название до « - цвет», «with», «in», «for», «w/», « + »,
 * « & », « / », «:», запятой и скобки; главное слово — САМОЕ ПРАВОЕ из известных
 * существительных (куртка, сумка или не наше), а не буквально последнее слово:
 * цвет и размер без тире («Puffer Pants Black») его не прячут. Слова с цифрами
 * (размеры) пропускаем. Русский: слово из списка в начале названия и ни одного
 * слова куртки/сумки во фразе. Чехол — только для техники и очков: «Vanity Case»
 * (сумка-бокс) остаётся. Без \b для кириллицы — он её не видит.
 */
const JACKET_NOUN = /^(?:jackets?|coats?|parkas?|puffers?|anoraks?|trench(?:es|coats?)?|bombers?|blazers?|gilets?|vests?|windbreakers?|overcoats?|raincoats?|capes?|ponchos?|overshirts?|shackets?)$/;
const BAG_NOUN = /^(?:bags?|handbags?|totes?|hobos?|clutch(?:es)?|cross-?body|backpacks?|rucksacks?|satchels?|purses?|pouch(?:es)?|baguettes?|duffel|duffle|weekender|shoppers?|bumbag|fanny|wristlets?|minaudieres?|bucket)$/;
const NON_TARGET_EN = /^(?:pants?|trousers?|jeans|shorts|skirts?|dress(?:es)?|leggings?|jumpsuits?|overalls?|tumblers?|flasks?|bottles?|mugs?|cups?|plates?|bowls?|socks?|pyjamas?|pajamas?|sweaters?|jumpers?|t-?shirts?|shirts?|blouses?|bodysuits?|swimsuits?|bikinis?|towels?|blankets?|pillows?|candles?|hats?|caps?|beanies?|scarves|scarf|gloves?|belts?|shoes?|boots?|sneakers?|sandals?|loafers?|slippers?|suits?|tops?|tanks?|camis?|camisoles?|cardigans?|hoodies?|sweatshirts?|rompers?|playsuits?|gowns?|kaftans?|tunics?|joggers|sweatpants|tights|corsets?|bras?|bralettes?|necklaces?|earrings?|bracelets?|rings?|hangers?|covers?|sleeves?|organi[sz]ers?|inserts?|straps?|charms?|wallets?|holders?|keyrings?|keychains?|pads?|hooks?)$/;
const NON_TARGET_CASE = /(?:laptop|phone|glasses|sunglasses|card|key|passport|tablet|airpods|ipad)\s+cases?$/;
const NON_TARGET_RU = new Set(["брюки", "штаны", "юбка", "платье", "джинсы", "шорты", "футболка", "свитер", "джемпер", "худи", "толстовка", "термос", "бутылка", "носки", "шапка", "шарф", "перчатки", "ремень", "обувь", "кроссовки", "ботинки", "сапоги", "костюм", "топ", "майка", "рубашка", "блузка", "лонгслив", "комбинезон", "кардиган", "туника", "сарафан", "леггинсы", "колготки", "боди", "купальник", "халат", "пижама", "водолазка", "поло", "кофта"]);
const TARGET_WORD_RU = /куртк|пальто|пуховик|ветровк|тренч|плащ|парка|бомбер|жилет|косух|дубл[её]нк|шуб[аы]|анорак|жакет|пиджак|блейзер|сумк|клатч|шопер|шоппер|рюкзак|кросс-?боди|тоут|хобо|багет|бананк|саквояж/;
const PHRASE_SPLIT = /\s+[-–—|/+&]\s+|\s*:\s+|\s+(?:with|in|and|for|by|from|w\/|для|с)\s+|\s*[,;]\s+/;

export type HeadKind = "jacket" | "bag" | "other";

/** Главное слово названия: куртка, сумка, не наше; null — по названию не понять (решают тип и теги). */
export function headKind(title: string | null | undefined): HeadKind | null {
  const lower = (title ?? "").toLowerCase().replace(/ё/g, "е").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!lower) return null;
  const phrase = lower.split(PHRASE_SPLIT)[0].trim();
  if (!phrase) return null;
  if (/[а-я]/.test(phrase)) {
    const parts = phrase.split(/\s+/).flatMap((t) => t.split("-"));
    return parts.some((t) => NON_TARGET_RU.has(t)) && !TARGET_WORD_RU.test(phrase) ? "other" : null;
  }
  const words = phrase.split(/\s+/).filter((w) => !/\d/.test(w));
  if (NON_TARGET_CASE.test(words.join(" "))) return "other";
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (NON_TARGET_EN.test(word)) return "other";
    if (JACKET_NOUN.test(word)) return "jacket";
    if (BAG_NOUN.test(word)) return "bag";
  }
  return null;
}

/** Главное слово — не куртка и не сумка (штаны, платья, посуда, ремни, чехлы). */
export function nonTargetHead(title: string | null | undefined): boolean {
  return headKind(title) === "other";
}

/**
 * К какому разделу относится товар; null — не наш (кошельки, шарфы, обувь,
 * штаны, платья, посуда — см. headKind). Главное слово решает раздел:
 * «Shell Bag» у Rains — сумка, «Duffel Coat» — куртка, а не сумка. Если слово
 * не понять по названию — старый путь: тип товара, затем теги.
 */
export function classifyItem(item: CatalogItem, categories: AssortmentDirection[]): AssortmentDirection | null {
  const kind = headKind(item.title);
  if (kind === "other") return null;
  if (kind === "bag") return categories.includes("bags") ? "bags" : null;
  if (kind === "jacket") return categories.includes("jackets") ? "jackets" : null;
  const head = `${item.productType} ${item.title}`;
  const bagAllowed = categories.includes("bags") && !NOT_BAGS.test(head);
  if (bagAllowed && BAGS.test(head)) return "bags";
  if (categories.includes("jackets") && JACKETS.test(head)) return "jackets";
  if (bagAllowed && BAGS.test(item.tags.join(" "))) return "bags";
  if (categories.includes("jackets") && JACKETS.test(item.tags.join(" "))) return "jackets";
  return null;
}

export interface CrawlPlan {
  baseline: boolean;
  fresh: CatalogItem[];
  /** Невиданные раньше, но давно опубликованные: в базу, не в ленту. */
  late: CatalogItem[];
}

export const FRESH_DAYS = 60;

/**
 * Первый обход — база. Дальше новинка — это товар, которого раньше не видели
 * И который опубликован недавно: каталог больше предела страниц, и старый
 * товар, впервые попавший в окно обхода, новинкой не становится.
 */
export function crawlPlan(known: Set<string>, fetched: CatalogItem[], nowMs = Date.now()): CrawlPlan {
  if (known.size === 0) return { baseline: true, fresh: [], late: [] };
  const unseen = fetched.filter((item) => !known.has(item.sourceItemId));
  const recent = (item: CatalogItem) => {
    if (!item.publishedAt) return true;
    const published = Date.parse(item.publishedAt);
    return Number.isNaN(published) || nowMs - published <= FRESH_DAYS * 24 * 3600 * 1000;
  };
  return { baseline: false, fresh: unseen.filter(recent), late: unseen.filter((item) => !recent(item)) };
}

/** Коллекции новинок из паспорта источника: «…; коллекции women, new-arrivals; …». */
export function collectionHandles(note: string | null): string[] {
  const match = (note ?? "").match(/коллекци[яи]\s+([^;]+)/i);
  if (!match) return [];
  return match[1].split(",").map((h) => h.trim()).filter((h) => /^[a-z0-9][a-z0-9-]*$/i.test(h));
}

export function collectionUrl(seed: string, handle: string, page: number): string {
  const url = new URL(seed);
  return `${url.protocol}//${url.host}/collections/${handle}/products.json?limit=${CATALOG_PAGE_SIZE}&page=${page}`;
}

/** Сначала коллекции (там новинки), затем весь каталог; дубли по ID отбрасываются. */
export function mergeCatalog(...lists: CatalogItem[][]): CatalogItem[] {
  const seen = new Map<string, CatalogItem>();
  for (const list of lists) for (const item of list) if (!seen.has(item.sourceItemId)) seen.set(item.sourceItemId, item);
  return [...seen.values()];
}

export function catalogUrl(seed: string, page: number): string {
  const url = new URL(seed);
  return `${url.protocol}//${url.host}/products.json?limit=${CATALOG_PAGE_SIZE}&page=${page}`;
}

export function productUrl(seed: string, handle: string): string {
  const url = new URL(seed);
  return `${url.protocol}//${url.host}/products/${encodeURIComponent(handle)}`;
}

/** Источник обходим, если доступ проверен и в паспорте указан products.json. */
export function isShopifyCrawlable(source: { access_status: string; access_note: string | null; seed_urls: string[] }): boolean {
  return source.access_status === "auto_verified" && /products\.json/i.test(source.access_note ?? "") && source.seed_urls.some((s) => /^https?:\/\//.test(s));
}
