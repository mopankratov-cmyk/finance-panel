/**
 * Российские бренды — обход каталогов их собственных сайтов (запрос владельца
 * 03.10.2026: «не забудь про лайм»). Чистые функции: паспорт, адреса страниц,
 * разбор карточек.
 *
 * Только то, что сайт открыто отдаёт роботам. Lime (limestore.com, 03.10):
 * robots.txt разрешает каталог, постраничную выдачу `?page=` и карту сайта,
 * запрещает страницы товаров `/product*` — их не открываем. Цену из карточки
 * не читаем. Старый домен lime-shop.com закрыт проверкой на бота — не трогаем.
 *
 * Новинка — по карте сайта, а не по каталогу: сервер отдаёт в HTML только
 * часть карточек страницы (остальные догружает браузер), раздел целиком так не
 * увидеть. Карта же полная (03.10 — 6 851 модель): модель, которой не было в
 * прошлой карте, — новая; название и фото берём из каталога, когда она там
 * покажется (ждём до 30 дней).
 */

import type { MappedRecord } from "./brightdataCatalog";
import type { AssortmentDirection } from "./constants";

export interface RuShopSection {
  direction: AssortmentDirection;
  /** Раздел каталога на сайте бренда. */
  slug: string;
}

export interface RuShop {
  sourceId: string;
  name: string;
  brand: string;
  catalogBase: string;
  sitemapUrl: string;
  sections: RuShopSection[];
  /** Дни обхода (UTC, 0 — вс): новинки у брендов выходят раз-два в неделю. */
  weekdaysUtc: number[];
  /** Потолок страниц раздела: дошли до него — раздел обрезан, новинкам не верим. */
  maxPages: number;
  method: string;
  accessNote: string;
}

export const RU_SHOPS: RuShop[] = [
  {
    sourceId: "S130",
    name: "Lime",
    brand: "LIMÉ",
    catalogBase: "https://limestore.com/ru_ru/catalog/",
    sitemapUrl: "https://limestore.com/sitemap.xml",
    sections: [
      { direction: "bags", slug: "women_bags" },
      { direction: "jackets", slug: "women_outerwear" },
    ],
    weekdaysUtc: [1, 4],
    maxPages: 40,
    method: "crawl_lime",
    accessNote: "Обход limestore.com пн и чт: новинки по карте сайта, название и фото из каталога (сумки, верхняя одежда); robots.txt разрешает каталог, ?page= и карту; страницы товаров не открываем; цены не читаем",
  },
];

export function ruShopPageUrl(shop: Pick<RuShop, "catalogBase">, slug: string, page: number): string {
  return page <= 1 ? `${shop.catalogBase}${slug}` : `${shop.catalogBase}${slug}?page=${page}`;
}

/** Модель Lime — число в начале адреса: «37983-0302_553_610_krasnyi» → 37983 (цвета — одна модель). */
export function limeModelId(path: string): string | null {
  const slug = path.split("/product/")[1] ?? "";
  const match = slug.match(/^(\d{4,})[-_]/);
  return match ? match[1] : null;
}

/** Фото CDN Lime: в карточке превью `?w=480`; берём 1 200 px. */
export function limeImage(raw: string): string {
  try {
    const url = new URL(raw.replace(/&amp;/g, "&"));
    url.searchParams.set("w", "1200");
    return url.toString();
  } catch {
    return raw;
  }
}

const decode = (text: string) => text
  .replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * Карточки каталога Lime из HTML страницы: ссылка-картинка
 * `CatalogProduct__image-link` с первым `<img src alt>` внутри. Цены рядом не
 * читаем. Повторы модели (цвета) схлопнет общий приём записей.
 */
export function parseLimeCatalog(html: string, origin = "https://limestore.com"): MappedRecord[] {
  const out: MappedRecord[] = [];
  const seen = new Set<string>();
  const card = /<a href="(\/ru_ru\/product\/[^"]+)" class="CatalogProduct__image-link"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(card)) {
    const path = match[1];
    const id = limeModelId(path);
    const img = match[2].match(/<img[^>]*\ssrc="([^"]+)"[^>]*\salt="([^"]*)"/) ?? match[2].match(/<img[^>]*\salt="([^"]*)"[^>]*\ssrc="([^"]+)"/);
    if (!id || !img) continue;
    const [src, alt] = img[0].indexOf("src=") < img[0].indexOf("alt=") ? [img[1], img[2]] : [img[2], img[1]];
    const title = decode(alt);
    if (!title || seen.has(path)) continue;
    seen.add(path);
    out.push({
      sourceItemId: id,
      url: `${origin}${path}`,
      title,
      brand: "LIMÉ",
      category: "",
      color: null,
      images: /^https?:\/\//.test(src) ? [limeImage(src)] : [],
      reviews: null,
      rating: null,
    });
  }
  return out;
}

/** Модели из карты сайта: все ссылки на товары → номера моделей. */
export function sitemapModelIds(xml: string): Set<string> {
  const ids = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const id = match[1].includes("/product/") ? limeModelId(new URL(match[1]).pathname) : null;
    if (id) ids.add(id);
  }
  return ids;
}

export interface SitemapState {
  /** Модели прошлой карты; null — карты ещё не было (первый обход — база). */
  models: string[] | null;
  /** Новые по карте, но ещё не увиденные в каталоге: модель → когда появилась в карте. */
  pending: Record<string, string>;
}

export function readSitemapState(capabilities: unknown): SitemapState {
  const raw = (capabilities as { sitemap?: { models?: unknown; pending?: unknown } } | null)?.sitemap;
  const models = Array.isArray(raw?.models) ? raw.models.map(String) : null;
  const pending = raw?.pending && typeof raw.pending === "object" && !Array.isArray(raw.pending)
    ? Object.fromEntries(Object.entries(raw.pending as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"))
    : {};
  return { models, pending };
}

export const PENDING_DAYS = 30;

export interface SitemapDiff {
  baseline: boolean;
  /** Перестройка сайта: «новых» разом сотни — не верим, ложится базой. */
  massChange: boolean;
  /** Кандидаты в новинки: новые по этой карте + ждущие с прошлых. */
  fresh: Set<string>;
  pending: Record<string, string>;
}

export function sitemapDiff(state: SitemapState, now: Set<string>, nowIso: string): SitemapDiff {
  if (!state.models || state.models.length === 0) return { baseline: true, massChange: false, fresh: new Set(), pending: {} };
  const prev = new Set(state.models);
  const added = [...now].filter((id) => !prev.has(id));
  const massChange = added.length > Math.max(300, prev.size * 0.2);
  const cutoff = Date.parse(nowIso) - PENDING_DAYS * 24 * 3600 * 1000;
  const pending: Record<string, string> = {};
  for (const [id, since] of Object.entries(state.pending)) if (Date.parse(since) >= cutoff && now.has(id)) pending[id] = since;
  if (!massChange) for (const id of added) pending[id] ??= nowIso;
  return { baseline: false, massChange, fresh: new Set(Object.keys(pending)), pending };
}

/** Что сохранить после обхода: новая карта и те, кого так и не увидели в каталоге. */
export function nextSitemapState(now: Set<string>, diff: SitemapDiff, seenInCatalog: Set<string>): { models: string[]; pending: Record<string, string> } {
  const pending = Object.fromEntries(Object.entries(diff.pending).filter(([id]) => !seenInCatalog.has(id)));
  return { models: [...now].sort(), pending };
}
