/**
 * Zalando — законный бесплатный источник новинок для брендов, чьи сайты закрыты
 * проверкой на бота (Bershka, Pull&Bear, Massimo Dutti). robots.txt Zalando
 * разрешает страницы «бренд × раздел» для обычного агента (наш
 * `FinancePanelAssortmentBot/1.0` не в списке запрещённых); страницы
 * server-rendered, с сортировкой по новизне. Данные — в гидратационном JSON
 * страницы: артикул, английское название, пол (WOMEN), силуэт (BAG/COAT/…),
 * фото. Цены оттуда не берём. Zalando — зарубежный сайт: ходим из облака
 * (не с mini, у него российский выход).
 */

import type { MappedRecord } from "./brightdataCatalog";
import type { AssortmentDirection } from "./constants";

export interface ZalandoTarget {
  sourceId: string;
  brand: string;
  direction: AssortmentDirection;
  /** Страница «бренд × раздел», отсортированная по новизне. */
  url: string;
  /** Силуэты Zalando, относящиеся к разделу: сумки — BAG; верхняя одежда — пальто/куртки/жилеты. */
  silhouettes: string[];
}

const BAG_SIL = ["BAG"];
const OUTER_SIL = ["COAT", "JACKET", "VEST", "PARKA", "ANORAK", "BLAZER"];
const NOT_BAG = /kulturbeutel|kosmetiktasche|geldb[oö]rse|portemonnaie|brustbeutel|wallet|card ?holder|pouch|toiletry|coin purse|kartenetui/i;
const base = (slug: string) => `https://www.zalando.de/${slug}/?order=activation_date`;

/** Источники Zalando: один на бренд, по странице на раздел. */
export const ZALANDO_SOURCES: Array<{ sourceId: string; name: string; brand: string }> = [
  { sourceId: "S138", name: "Bershka (Zalando)", brand: "Bershka" },
  { sourceId: "S139", name: "Pull&Bear (Zalando)", brand: "Pull&Bear" },
  { sourceId: "S140", name: "Massimo Dutti (Zalando)", brand: "Massimo Dutti" },
];

export const ZALANDO_TARGETS: ZalandoTarget[] = [
  { sourceId: "S138", brand: "Bershka", direction: "bags", url: base("taschen-accessoires-taschen-damen/bershka"), silhouettes: BAG_SIL },
  { sourceId: "S138", brand: "Bershka", direction: "jackets", url: base("damenbekleidung-jacken/bershka"), silhouettes: OUTER_SIL },
  { sourceId: "S139", brand: "Pull&Bear", direction: "bags", url: base("taschen-accessoires-taschen-damen/pull-and-bear"), silhouettes: BAG_SIL },
  { sourceId: "S139", brand: "Pull&Bear", direction: "jackets", url: base("damenbekleidung-jacken/pull-and-bear"), silhouettes: OUTER_SIL },
  { sourceId: "S140", brand: "Massimo Dutti", direction: "bags", url: base("taschen-accessoires-taschen-damen/massimo-dutti"), silhouettes: BAG_SIL },
  { sourceId: "S140", brand: "Massimo Dutti", direction: "jackets", url: base("damenbekleidung-jacken/massimo-dutti"), silhouettes: OUTER_SIL },
];

export const ZALANDO_IMAGE_HOST = "img01.ztat.net";

/** Артикул Zalando «BEJ51H0NY-O11» → модель «BEJ51H0NY» (цвет после дефиса — та же модель). */
export function zalandoModel(sku: string): string {
  const cut = sku.lastIndexOf("-");
  return cut > 0 ? sku.slice(0, cut) : sku;
}

/** Фото Zalando ~480 px (CDN поддерживает imwidth). */
export function zalandoImage(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:" || !url.hostname.endsWith("ztat.net")) return null;
    url.searchParams.set("imwidth", "480");
    return url.toString();
  } catch {
    return null;
  }
}

const decode = (text: string) => text
  .replace(/\\u002F/gi, "/").replace(/\\"/g, "\"").replace(/\\\\/g, "\\")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

interface ZalandoProduct {
  sku: string;
  name: string;
  /** Чистое английское название без немецкого типа и цвета. */
  supplierName: string;
  group: string;
  silhouette: string;
  image: string | null;
}

/** Товары из гидратационного JSON страницы (все силуэты, только WOMEN). */
export function parseZalandoProducts(html: string): ZalandoProduct[] {
  const out: ZalandoProduct[] = [];
  const seen = new Set<string>();
  const re = /"sku":"([A-Z0-9-]+)","name":"((?:[^"\\]|\\.)*)","navigationTargetGroup":"([A-Z]+)","silhouette":"([A-Z]*)","supplierName":((?:"(?:[^"\\]|\\.)*")|null)[\s\S]{0,400}?"gallerySmall":\{"__typename":"Image","uri":"((?:[^"\\]|\\.)*)"/g;
  for (const m of html.matchAll(re)) {
    const [, sku, name, group, silhouette, supplier, uri] = m;
    if (seen.has(sku)) continue;
    seen.add(sku);
    const supplierName = supplier && supplier !== "null" ? decode(supplier.slice(1, -1)) : "";
    out.push({ sku, name: decode(name), supplierName, group, silhouette, image: zalandoImage(decode(uri)) });
  }
  return out;
}

/**
 * Карточки раздела: только WOMEN и нужные силуэты. Название чистим до
 * человеческого (убираем немецкий тип и цвет из хвоста). Категорию ставим
 * понятным словом — чтобы общий приём записей не отсеял немецкие названия.
 */
/** Настоящие адреса товаров Zalando из страницы, по артикулу (адрес из одного артикула — 404). */
export function zalandoUrlsBySku(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/https:\/\/www\.zalando\.de\/[a-z0-9-]+-([a-z0-9]+-[a-z0-9]+)\.html/gi)) {
    const sku = m[1].toUpperCase();
    if (!out.has(sku)) out.set(sku, m[0]);
  }
  return out;
}

export function parseZalandoCatalog(html: string, target: Pick<ZalandoTarget, "brand" | "direction" | "silhouettes">): MappedRecord[] {
  const allow = new Set(target.silhouettes);
  const urls = zalandoUrlsBySku(html);
  const out: MappedRecord[] = [];
  const seenModel = new Set<string>();
  for (const p of parseZalandoProducts(html)) {
    if (p.group !== "WOMEN" || !allow.has(p.silhouette)) continue;
    // Под силуэтом BAG бывают косметички и кошельки — не наш раздел.
    if (target.direction === "bags" && NOT_BAG.test(p.name)) continue;
    const model = zalandoModel(p.sku);
    const url = urls.get(p.sku);
    if (!url || seenModel.has(model)) continue;
    seenModel.add(model);
    // Чистое название — supplierName; иначе из общего (там немецкий тип и цвет в хвосте).
    const parts = p.name.split(" - ");
    const fallback = parts.length >= 2 && /[A-Z]{2}/.test(parts[0]) ? parts[0] : p.name;
    const title = (p.supplierName || fallback).slice(0, 140);
    out.push({
      sourceItemId: model,
      url,
      title,
      brand: target.brand,
      category: target.direction === "bags" ? "bag" : "jacket",
      color: null,
      images: p.image ? [p.image] : [],
      reviews: null,
      rating: null,
    });
  }
  return out;
}

/** Дни обхода Zalando (UTC): пн и чт. */
export const ZALANDO_WEEKDAYS_UTC = [1, 4];

export interface ZalandoPagePlan {
  sourceId: string;
  brand: string;
  direction: AssortmentDirection;
  url: string;
}

/**
 * План для загрузчика на mini: Zalando блокирует облако Vercel (AWS), а mini
 * (и обычный выход) пускает. Загрузчик скачивает эти страницы и отдаёт панели,
 * разбор — на сервере. По дням источника, либо все (`all`) / один (`only`).
 */
export function zalandoMiniPlan(now: Date, options: { all?: boolean; only?: string | null } = {}): ZalandoPagePlan[] {
  if (!options.all && !options.only && !ZALANDO_WEEKDAYS_UTC.includes(now.getUTCDay())) return [];
  return ZALANDO_TARGETS
    .filter((t) => (options.only ? t.sourceId === options.only : true))
    .map((t) => ({ sourceId: t.sourceId, brand: t.brand, direction: t.direction, url: t.url }));
}

/** Цель Zalando по адресу страницы (для разбора присланной загрузчиком страницы). */
export function zalandoTargetByUrl(url: string): ZalandoTarget | undefined {
  return ZALANDO_TARGETS.find((t) => t.url === url);
}
