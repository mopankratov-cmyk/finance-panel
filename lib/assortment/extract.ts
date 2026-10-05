/**
 * Разбор внешних карточек товара для модуля ассортимента. Чистые функции.
 *
 * Граница ТЗ: цены, валюты и любая экономика отбрасываются здесь, на входе —
 * результат разбора таких полей не содержит вовсе.
 */

export interface ExtractedProduct {
  sourceItemId: string | null;
  title: string | null;
  brand: string | null;
  article: string | null;
  canonicalUrl: string | null;
  images: string[];
  publishedAt: string | null;
  productType: string | null;
  colors: string[];
  newBadge: string | null;
  bestsellerBadge: string | null;
}

const MAX_IMAGES = 6;

export function normalizeProductUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  // Shopify: /collections/<x>/products/<handle> и /products/<handle> — одна карточка.
  const shopify = url.pathname.match(/\/products\/([^/]+)/);
  if (shopify) url.pathname = `/products/${shopify[1]}`;
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

/** Регион витрины из адреса (/gb/, /us/, /uk/…), иначе пусто. */
export function regionFromUrl(raw: string): string {
  const first = new URL(raw).pathname.split("/").filter(Boolean)[0] ?? "";
  const code = first.toLowerCase().split("-")[0];
  return /^[a-z]{2}$/.test(code) && !["en", "ru", "products", "collections"].includes(code) ? code.toUpperCase() : "";
}

export function shopifyProductJsonUrl(raw: string): string | null {
  const url = new URL(raw);
  const match = url.pathname.match(/\/products\/([^/.]+)/);
  if (!match) return null;
  return `${url.protocol}//${url.host}/products/${match[1]}.json`;
}

export function dedupKey(sourceId: string | null, region: string, sourceItemId: string | null, normalizedUrl: string): string {
  return [sourceId ?? "manual", region, sourceItemId ?? normalizedUrl].join("|");
}

/**
 * Ключ находки при импорте по ссылке. Артикул однозначен только внутри сайта: у источника вне паспорта (`sourceId` пуст) ключ был бы
 * «manual||<sku>» без хоста, и товары двух разных сайтов с одним sku склеивались бы в одну находку (фото второго подмешивались к первому).
 */
export function importDedupKey(sourceId: string | null, region: string, sourceItemId: string | null, normalizedUrl: string, pageUrl: string): string {
  const scoped = sourceItemId && !sourceId ? `${baseDomain(new URL(pageUrl).hostname)}:${sourceItemId}` : sourceItemId;
  return dedupKey(sourceId, region, scoped, normalizedUrl);
}

const SECOND_LEVEL = new Set(["co.uk", "com.au", "co.jp", "com.cn", "com.tr", "co.kr", "com.hk", "com.br"]);

/** Домен бренда без поддомена витрины: eng.polene-paris.com и eu.polene-paris.com — один сайт. */
export function baseDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  const tail = labels.slice(-2).join(".");
  return SECOND_LEVEL.has(tail) ? labels.slice(-3).join(".") : tail;
}

/** Источник по домену: сравниваем с сайтами из паспорта (seed_urls). */
export function detectSourceId(rawUrl: string, sources: Array<{ sourceId: string; seedUrls: string[] }>): string | null {
  const domain = baseDomain(new URL(rawUrl).hostname);
  for (const source of sources) {
    for (const seed of source.seedUrls) {
      try {
        const seedUrl = new URL(/^https?:\/\//i.test(seed) ? seed : `https://${seed}`);
        if (baseDomain(seedUrl.hostname) === domain) return source.sourceId;
      } catch {
        // мусор вместо адреса — пропускаем
      }
    }
  }
  return null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function uniqueUrls(urls: Array<string | null | undefined>, base?: string): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    if (!raw) continue;
    try {
      const absolute = new URL(raw.startsWith("//") ? `https:${raw}` : raw, base).toString();
      if (/^https?:/.test(absolute) && !out.includes(absolute)) out.push(absolute);
    } catch {
      // битая ссылка на картинку — пропускаем
    }
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

function newBadgeFromTags(tags: string[]): string | null {
  return tags.find((tag) => /(^|[^a-z])new([^a-z]|$)|new ?arrival|newproduct|new in/i.test(tag)) ?? null;
}

function bestsellerFromTags(tags: string[]): string | null {
  return tags.find((tag) => /best[\s_-]?sell/i.test(tag)) ?? null;
}

/** Карточка Shopify (`/products/<handle>.json`): берём только разрешённые поля. */
export function parseShopifyProduct(json: unknown): ExtractedProduct | null {
  const product = (json as { product?: Record<string, unknown> })?.product;
  if (!product || typeof product !== "object") return null;
  const tags = typeof product.tags === "string"
    ? product.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : Array.isArray(product.tags) ? product.tags.map(String) : [];
  const options = Array.isArray(product.options) ? product.options as Array<{ name?: string; values?: unknown[] }> : [];
  const colorOption = options.find((o) => /colou?r|цвет/i.test(o.name ?? ""));
  const variants = Array.isArray(product.variants) ? product.variants as Array<Record<string, unknown>> : [];
  const images = Array.isArray(product.images) ? product.images as Array<{ src?: string }> : [];
  return {
    sourceItemId: product.id != null ? String(product.id) : null,
    title: text(product.title),
    brand: text(product.vendor),
    article: text(variants.find((v) => text(v.sku))?.sku),
    canonicalUrl: null,
    images: uniqueUrls(images.map((i) => i.src)),
    publishedAt: text(product.published_at),
    productType: text(product.product_type),
    colors: (colorOption?.values ?? []).map(String).filter(Boolean),
    newBadge: newBadgeFromTags(tags),
    bestsellerBadge: bestsellerFromTags(tags),
  };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Страница чужого сайта — недоверенный ввод до 3 МБ. Регулярки вида `<meta[^>]+…` на каждое «<meta» без «>» проходили текст до конца
 * и откатывались: время росло квадратом (59 КБ — секунда, 234 КБ — 17 с), и одна страница из повторяющегося «<meta » держала функцию до
 * её таймаута. Поэтому — один линейный проход: теги находятся по «<имя», конец тега ищется монотонным указателем, длинный «тег» (больше
 * MAX_TAG) тегом не считается, содержимое script пропускается целиком.
 */
const MAX_TAG = 4096;
/** Документ режем: JSON-LD и og:-теги лежат в начале страницы. */
const MAX_DOCUMENT = 1_500_000;

interface HtmlDocument {
  metas: string[];
  links: string[];
  ldBlocks: string[];
  title: string | null;
}

function scanDocument(source: string): HtmlDocument {
  const html = source.length > MAX_DOCUMENT ? source.slice(0, MAX_DOCUMENT) : source;
  const doc: HtmlDocument = { metas: [], links: [], ldBlocks: [], title: null };
  const re = /<(meta|link|script|title)(?=[\s/>])/gi;
  let gt = -2; // ближайшее «>» не левее текущего тега; -1 — «>» больше нет
  let closeAt = -2; // ближайшее «</script» не левее конца текущего тега; -1 — больше нет
  for (let match = re.exec(html); match; match = re.exec(html)) {
    if (gt === -1) break;
    if (gt < match.index) {
      gt = html.indexOf(">", match.index);
      if (gt < 0) {
        gt = -1;
        break;
      }
    }
    if (gt - match.index > MAX_TAG) continue;
    const name = match[1].toLowerCase();
    const tag = html.slice(match.index, gt + 1);
    re.lastIndex = gt + 1;
    if (name === "meta") doc.metas.push(tag);
    else if (name === "link") doc.links.push(tag);
    else if (name === "title") {
      if (doc.title === null) {
        const stop = html.indexOf("<", gt + 1);
        doc.title = html.slice(gt + 1, stop < 0 ? Math.min(html.length, gt + 1 + 500) : Math.min(stop, gt + 1 + 500));
      }
    } else {
      // script: тело пропускаем целиком (в нём бывают строки «<meta»), JSON-LD сохраняем.
      if (closeAt !== -1 && closeAt < gt + 1) {
        const found = indexOfIgnoreCase(html, "</script", gt + 1);
        closeAt = found < 0 ? -1 : found;
      }
      if (closeAt === -1) break;
      if (/type\s*=\s*["']application\/ld\+json["']/i.test(tag)) doc.ldBlocks.push(html.slice(gt + 1, closeAt));
      re.lastIndex = closeAt + 8;
    }
  }
  return doc;
}

/** Поиск без учёта регистра без копии всего текста в нижнем регистре (его длина может не совпасть с исходной). */
function indexOfIgnoreCase(haystack: string, needle: string, from: number): number {
  const first = needle[0];
  const upper = first.toUpperCase();
  let pos = from;
  while (pos < haystack.length) {
    const a = haystack.indexOf(first, pos);
    const b = upper === first ? -1 : haystack.indexOf(upper, pos);
    const at = a < 0 ? b : b < 0 ? a : Math.min(a, b);
    if (at < 0) return -1;
    if (haystack.substr(at, needle.length).toLowerCase() === needle) return at;
    pos = at + 1;
  }
  return -1;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:^|[\\s"'/])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? match[1] ?? match[2] ?? "" : null;
}

function metaContent(doc: HtmlDocument, key: string): string[] {
  const out: string[] = [];
  for (const tag of doc.metas) {
    const names = [attribute(tag, "property"), attribute(tag, "name")];
    if (!names.some((value) => value !== null && value.toLowerCase() === key.toLowerCase())) continue;
    const content = attribute(tag, "content");
    if (content) out.push(decodeEntities(content));
  }
  return out;
}

function jsonLdProducts(doc: HtmlDocument): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) out.push(record);
    if (record["@graph"]) visit(record["@graph"]);
  };
  for (const body of doc.ldBlocks) {
    try {
      visit(JSON.parse(body));
    } catch {
      // сломанный JSON-LD у сайта — не повод падать
    }
  }
  return out;
}

/**
 * Каноническая ссылка страницы — поле чужого сайта и становится адресом находки (<a href> на карточке, ключ дедупликации): берём её, только
 * если это http(s) и тот же сайт, что у самой страницы. «javascript:…» и чужой домен (канонический адрес «на фишинг») отбрасываются —
 * находка остаётся с адресом страницы.
 */
export function trustedCanonical(href: string, pageUrl: string): string | null {
  try {
    const page = new URL(pageUrl);
    const canonical = new URL(href, page);
    if (canonical.protocol !== "https:" && canonical.protocol !== "http:") return null;
    if (baseDomain(canonical.hostname) !== baseDomain(page.hostname)) return null;
    return canonical.toString();
  } catch {
    return null;
  }
}

/** Обычная HTML-страница товара: JSON-LD Product, затем og:-теги. */
export function extractHtmlProduct(html: string, pageUrl: string): ExtractedProduct {
  const doc = scanDocument(html);
  const ld = jsonLdProducts(doc)[0];
  const ldImages = ld ? (Array.isArray(ld.image) ? ld.image : [ld.image]).map((i) => (typeof i === "string" ? i : (i as { url?: string })?.url ?? null)) : [];
  const brand = ld?.brand;
  const canonicalTag = doc.links.find((tag) => (attribute(tag, "rel") ?? "").toLowerCase() === "canonical");
  const canonical = canonicalTag ? attribute(canonicalTag, "href") : null;
  return {
    sourceItemId: text(ld?.productID) ?? text(ld?.sku) ?? null,
    title: text(ld?.name) ?? text(metaContent(doc, "og:title")[0]) ?? text(doc.title),
    brand: text(typeof brand === "string" ? brand : (brand as { name?: string })?.name),
    article: text(ld?.sku) ?? text(ld?.mpn),
    canonicalUrl: canonical ? trustedCanonical(decodeEntities(canonical), pageUrl) : null,
    images: uniqueUrls([...ldImages, ...metaContent(doc, "og:image"), ...metaContent(doc, "twitter:image")], pageUrl),
    publishedAt: null,
    productType: text(ld?.category),
    colors: text(ld?.color) ? [text(ld?.color) as string] : [],
    newBadge: null,
    bestsellerBadge: null,
  };
}

/** Запасное название, если сайт ничего не отдал: хост и последний сегмент адреса. */
export function fallbackTitle(raw: string): string {
  const url = new URL(raw);
  const tail = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ").replace(/\.\w+$/, "");
  return [url.hostname.replace(/^www\./, ""), tail].filter(Boolean).join(" · ");
}
