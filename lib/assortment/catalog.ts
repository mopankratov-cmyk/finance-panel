/**
 * «Каталоги брендов» — всё, что обходы собрали у брендов, а не только новинки
 * (жалоба владельца 04.10: «в панели мало товаров»). Чистые функции: разбор
 * фильтров, превью фото по правилам CDN, карточка.
 *
 * Каталог читается прямо из базы обхода (assortment_source_items), находка в
 * assortment_references появляется только по нажатию человека («Отобрать»).
 * Фото — ссылки на сайт бренда, браузер грузит их сам; копий не храним.
 * Цен здесь нет.
 */

import type { AssortmentDirection } from "./constants";
import { productUrl } from "./crawl";
import { formOf, rulesFor } from "./forms";
import type { CatalogBadge } from "./sourceItems";

export const CATALOG_PAGE = 48;
export const CATALOG_PAGE_MAX = 96;
/** Модель, которую обход давно не видел (снята с продажи), в каталоге не показываем. */
export const CATALOG_SEEN_DAYS = 30;
export const CATALOG_FRESH_DAYS = 7;
const THUMB_WIDTH = 480;

export interface CatalogQuery {
  direction: AssortmentDirection;
  sourceId: string | null;
  search: string | null;
  fresh: boolean;
  badge: boolean;
  /** Форма модели по названию (ключ правила форм) или «unrecognized» — название формы не называет; null/нет — без фильтра. */
  form?: string | null;
  /**
   * with — только с фото, all — и без фото, auto — решает сервер: пока фото
   * есть меньше чем у половины моделей (обходы только начали их собирать),
   * показываем всё, а не пустой экран.
   */
  photo: CatalogPhotoMode;
  offset: number;
  limit: number;
}

export type CatalogPhotoMode = "with" | "all" | "auto";

/** Значение фильтра формы для моделей, чьё название формы не называет (блок «Название не называет форму» на «Формах»). */
export const FORM_UNRECOGNIZED = "unrecognized";

/** Ключ формы из адреса: известное правило раздела или «unrecognized»; остальное — без фильтра. */
export function parseFormKey(raw: string | null, direction: AssortmentDirection): string | null {
  if (!raw) return null;
  if (raw === FORM_UNRECOGNIZED) return raw;
  return rulesFor(direction).some((rule) => rule.key === raw) ? raw : null;
}

/** Подпись фильтра формы для экрана. */
export function formFilterLabel(form: string, direction: AssortmentDirection): string {
  if (form === FORM_UNRECOGNIZED) return "Название не называет форму";
  return rulesFor(direction).find((rule) => rule.key === form)?.label ?? form;
}

export function parseCatalogQuery(params: URLSearchParams, direction: AssortmentDirection): CatalogQuery {
  const source = params.get("source");
  const search = (params.get("q") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const offset = Math.max(0, Math.min(Number(params.get("offset")) || 0, 50_000));
  const limit = Math.max(1, Math.min(Number(params.get("limit")) || CATALOG_PAGE, CATALOG_PAGE_MAX));
  return {
    direction,
    sourceId: source && /^S\d{3,4}$/.test(source) ? source : null,
    search: search.length >= 2 ? search : null,
    fresh: params.get("fresh") === "1",
    badge: params.get("badge") === "1",
    form: parseFormKey(params.get("form"), direction),
    photo: params.get("photo") === "all" ? "all" : params.get("photo") === "with" ? "with" : "auto",
    offset: Math.floor(offset),
    limit: Math.floor(limit),
  };
}

/** Строка поиска для PostgREST `ilike`: свои % и _ не должны работать как шаблон. */
export function ilikePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ")}%`;
}

/**
 * Превью ~480 px: в сетке не нужен оригинал в 1 200–2 000 px. Только https и
 * только известные параметры CDN; остальное — как есть.
 */
export function thumbUrl(raw: string, width = THUMB_WIDTH): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // Снимки Zara старого вида удалены (404) — не показываем битую картинку, карточка скажет «фото будет позже».
  if (url.hostname === "static.zara.net" && url.pathname.startsWith("/photos/")) return null;
  const host = url.hostname;
  const w = String(width);
  if (host === "cdn.shopify.com" || url.pathname.includes("/cdn/shop/") || url.pathname.startsWith("/s/files/")) url.searchParams.set("width", w);
  // У ASOS пресет вида $n_480w$ — URLSearchParams закодировал бы $; собираем руками.
  else if (host === "images.asos-media.com") return `${url.origin}${url.pathname}?$n_${w}w$&wid=${w}&fit=constrain`;
  else if (host === "image.hm.com" || host.endsWith(".hm.com")) url.searchParams.set("imwidth", w);
  else if (host === "image.uniqlo.com") url.searchParams.set("width", w);
  // Zara: только если размер уже задан в адресе — подставлять параметр вслепую не будем.
  else if (host === "static.zara.net") { if (url.searchParams.has("w")) url.searchParams.set("w", w); }
  else if (host === "a.cdn.lime-shine.com") url.searchParams.set("w", w);
  else if (host === "imgcdn.befree.ru") url.pathname = url.pathname.replace(/\/images\/\d+\//, "/images/640/");
  // Love Republic отдаёт превью /thumb/600_9999/ — его сайт сам так грузит сетку. У ZARINA такого
  // размера нет (404, 04.10: «фото не открылось» у всех курток ZARINA) — её /thumb/900_9999/ как есть.
  else if (host === "imgcdn.loverepublic.ru") {
    url.pathname = url.pathname.includes("/thumb/")
      ? url.pathname.replace(/\/thumb\/\d+_\d+\//, "/thumb/600_9999/")
      : url.pathname.replace(/^(\/upload\/images\/[^/]+)\/([^/]+)$/, "$1/thumb/600_9999/$2");
  } else if (host === "cdn01.sela.ru") url.pathname = url.pathname.replace(/@2x(\.\w+)$/, "$1");
  return url.toString();
}

export interface CatalogRow {
  source_id: string;
  source_item_id: string;
  handle: string | null;
  title: string | null;
  product_type: string | null;
  first_seen_at: string;
  last_seen_at: string;
  baseline: boolean;
  reference_id: string | null;
  image_urls?: string[] | null;
  brand?: string | null;
  badges?: string[] | null;
  /** Сколько расцветок модели видел обход (вид assortment_catalog_heads); у строки таблицы — нет. */
  variants?: number | null;
}

export interface CatalogCard {
  sourceId: string;
  itemId: string;
  title: string;
  brand: string;
  productUrl: string | null;
  images: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  /** Новинка, которую обход заметил после базы, — за последние 7 дней. */
  isNew: boolean;
  badges: CatalogBadge[];
  /** Расцветок одной модели (карточка — одна на модель; цвета склеены ключом модели). */
  variants: number;
  /** Форма по названию (не по фото) — та же, что считают «Формы»; null — название формы не называет. */
  form: { key: string; label: string } | null;
  referenceId: string | null;
  /** Статус находки, если модель уже среди находок (новинка, отобрана, отклонена…). */
  referenceStatus?: string | null;
  /** Только на экране: модель скрыта кнопкой «Не интересно» (можно вернуть). */
  hiddenLocal?: boolean;
}

/** Ссылка на товар: у Shopify в handle только slug, у остальных — полный адрес. */
export function catalogProductUrl(handle: string | null, seedUrl: string | null): string | null {
  if (!handle) return null;
  if (/^https:\/\//.test(handle)) return handle;
  if (!seedUrl) return null;
  try {
    return productUrl(seedUrl, handle);
  } catch {
    return null;
  }
}

function cardForm(direction: AssortmentDirection | undefined, title: string | null): CatalogCard["form"] {
  const rule = direction ? formOf(direction, title) : null;
  return rule ? { key: rule.key, label: rule.label } : null;
}

export function toCatalogCard(row: CatalogRow, source: { name: string; seedUrl: string | null } | undefined, nowMs: number, direction?: AssortmentDirection): CatalogCard {
  const freshSince = nowMs - CATALOG_FRESH_DAYS * 24 * 3600 * 1000;
  return {
    sourceId: row.source_id,
    itemId: row.source_item_id,
    title: (row.title ?? "").trim() || "Без названия",
    brand: row.brand?.trim() || source?.name || row.source_id,
    productUrl: catalogProductUrl(row.handle, source?.seedUrl ?? null),
    images: (row.image_urls ?? []).map((u) => thumbUrl(u)).filter((u): u is string => Boolean(u)),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    isNew: !row.baseline && Date.parse(row.first_seen_at) >= freshSince,
    badges: (row.badges ?? []).filter((b): b is CatalogBadge => b === "new" || b === "bestseller"),
    variants: Math.max(1, Math.trunc(Number(row.variants) || 1)),
    form: cardForm(direction, row.title),
    referenceId: row.reference_id,
  };
}

export interface CatalogBrandStat {
  sourceId: string;
  name: string;
  models: number;
  withPhoto: number;
  new7d: number;
}

/**
 * Показывать ли модели без фото, если человек сам не выбрал: пока фото есть
 * меньше чем у половины моделей раздела (или выбранного бренда) — да.
 */
export function resolvePhotoMode(mode: CatalogPhotoMode, stats: CatalogBrandStat[] | null, sourceId: string | null): "with" | "all" {
  if (mode !== "auto") return mode;
  if (!stats) return "all";
  const pool = sourceId ? stats.filter((s) => s.sourceId === sourceId) : stats;
  const models = pool.reduce((s, b) => s + b.models, 0);
  const withPhoto = pool.reduce((s, b) => s + b.withPhoto, 0);
  return models > 0 && withPhoto * 2 >= models ? "with" : "all";
}

/** Счётчики чипов брендов из представления assortment_catalog_stats; пустые — не показываем. */
export function brandStats(
  rows: Array<{ source_id: string; direction: string; models: number; with_photo: number; new_7d: number }>,
  direction: AssortmentDirection,
  names: Map<string, string>,
): CatalogBrandStat[] {
  return rows
    .filter((r) => r.direction === direction && r.models > 0)
    .map((r) => ({ sourceId: r.source_id, name: names.get(r.source_id) ?? r.source_id, models: r.models, withPhoto: r.with_photo, new7d: r.new_7d }))
    .sort((a, b) => b.models - a.models || a.name.localeCompare(b.name, "ru"));
}

/** Фильтры экрана каталога (в адресе страницы). */
export interface CatalogFilters {
  source: string | null;
  q: string;
  fresh: boolean;
  badge: boolean;
  /** Форма по названию (ключ правила форм или «unrecognized»); приходит ссылкой с экрана «Формы». */
  form: string | null;
  /** with / all — выбор человека; auto — решает сервер по доле моделей с фото. */
  photo: CatalogPhotoMode;
}

/** Фильтры каталога после перехода с «Форм»: форма и «и без фото», чтобы число совпало со строкой формы. */
export function filtersForForm(form: string): CatalogFilters {
  return { ...DEFAULT_CATALOG_FILTERS, form, photo: "all" };
}

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = { source: null, q: "", fresh: false, badge: false, form: null, photo: "auto" };

type PageParams = Record<string, string | string[] | undefined>;
const one = (params: PageParams, key: string) => {
  const value = params[key];
  return typeof value === "string" ? value : null;
};

/** Фильтры каталога из адреса — читает серверная страница: без лишнего запроса и мигания. */
export function catalogFiltersFrom(params: PageParams, direction?: AssortmentDirection): CatalogFilters {
  const source = one(params, "source");
  const photo = one(params, "photo");
  return {
    source: source && /^S\d{3,4}$/.test(source) ? source : null,
    q: (one(params, "q") ?? "").slice(0, 80),
    fresh: one(params, "fresh") === "1",
    badge: one(params, "badge") === "1",
    // Ключ формы — по правилам раздела (страница знает раздел): чужой («bomber» на сумках) и устаревший ключ отбрасываются,
    // иначе экран говорил бы «фильтр включён», а список был бы целым. Без раздела — только безопасный вид (проверит сервер).
    form: ((value) => (direction ? parseFormKey(value, direction) : value && /^[a-z_]{2,24}$/.test(value) ? value : null))(one(params, "form")),
    photo: photo === "all" || photo === "with" ? photo : "auto",
  };
}

/**
 * Ключ формы из адреса, которого раздел не знает (чужой — «bomber» на сумках, устаревший): `catalogFiltersFrom` его отбрасывает, и
 * экран должен сказать об этом, а не молча показать весь каталог. null — формы в адресе нет или она принята.
 */
export function rejectedFormFrom(params: PageParams, direction: AssortmentDirection): string | null {
  const raw = one(params, "form");
  if (!raw || parseFormKey(raw, direction)) return null;
  // Ключ из адреса попадает на экран в доверенной плашке: показываем только то, что похоже на ключ правила (латиница, цифры, _ и -);
  // всё остальное — управляющие и bidi-символы, пробелы, готовые фразы — не показываем вовсе ("" — отброшено, но ключа не называем).
  return /^[a-z0-9_-]{1,40}$/i.test(raw) ? raw : "";
}

/** Вид раздела: лента находок, «Каталоги брендов» или «Формы» (разбор каталога по формам). */
export type SectionView = "new" | "work" | "retail" | "ru" | "hidden" | "catalog" | "forms";

export function sectionViewFrom(params: PageParams): SectionView {
  const view = one(params, "view");
  return view === "catalog" || view === "forms" || view === "work" || view === "retail" || view === "ru" || view === "hidden" ? view : "new";
}

/**
 * Сколько карточек из загруженных реально есть в выдаче сервера. Скрытая
 * кнопкой «Не интересно» карточка остаётся на экране плейсхолдером, а сервер её
 * уже исключил из выдачи: считать по длине массива — значит «Показать ещё»
 * запросит страницу со сдвигом и молча пропустит модели (и напишет «Показано 48
 * из 47»). Возвращённая («Вернуть») снова в выдаче.
 */
export function loadedOnServer(cards: ReadonlyArray<{ hiddenLocal?: boolean }>): number {
  return cards.filter((card) => !card.hiddenLocal).length;
}
