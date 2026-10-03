/**
 * Автообход каталогов Shopify-брендов (этап 2, пункт 4). Чистые функции.
 *
 * Берём из `/products.json` только идентификатор, handle, название, тип, теги
 * и дату публикации — цены и варианты отбрасываются здесь же (граница ТЗ).
 * Первый обход источника — база сравнения: в ленту не пишем ничего.
 */

import type { AssortmentDirection } from "./constants";

export interface CatalogItem {
  sourceItemId: string;
  handle: string;
  title: string;
  productType: string;
  tags: string[];
  publishedAt: string | null;
}

export const CATALOG_PAGE_SIZE = 250;
export const MAX_CATALOG_PAGES = 8;

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
    });
  }
  return out;
}

// \b в JS не видит границ кириллицы — русские основы идут без него.
const BAGS = /\b(bag|bags|handbags?|tote|hobo|clutch|cross-?body|shoulder|satchel|bucket|backpack|baguette|messenger|duffel|weekender)\b|сумк|клатч|шопер|рюкзак|кросс-?боди|тоут|хобо|багет|бананк|саквояж/i;
const NOT_BAGS = /\b(wallet|card ?holder|key ?ring|keychain|charm|strap|belt|scarf|glove|hat|cap|umbrella|socks?)\b|кошел|брелок|ремень|чехол/i;
const JACKETS = /\b(jackets?|coats?|parka|puffer|anorak|trench|bomber|blazer|gilet|vest|windbreaker|shell|outerwear)\b|куртк|пальто|пуховик|ветровк|тренч|плащ|парка|бомбер|жилет|косух|дубл[её]нк|шуб[аы]|анорак/i;

/**
 * К какому разделу относится товар; null — не наш (кошельки, шарфы, обувь).
 * Сумка в названии или типе важнее куртки: «Shell Bag» у Rains — сумка.
 */
export function classifyItem(item: CatalogItem, categories: AssortmentDirection[]): AssortmentDirection | null {
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
