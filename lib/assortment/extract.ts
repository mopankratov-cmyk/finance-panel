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

/** Источник по домену: сравниваем с сайтами из паспорта (seed_urls). */
export function detectSourceId(rawUrl: string, sources: Array<{ sourceId: string; seedUrls: string[] }>): string | null {
  const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  for (const source of sources) {
    for (const seed of source.seedUrls) {
      try {
        const seedHost = new URL(seed).hostname.toLowerCase().replace(/^www\./, "");
        if (seedHost && (host === seedHost || host.endsWith(`.${seedHost}`))) return source.sourceId;
      } catch {
        // seed без схемы или мусор — пропускаем
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
  };
}

function metaContent(html: string, key: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "gi");
  for (const tag of html.match(re) ?? []) {
    const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) out.push(decodeEntities(content));
  }
  return out;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function jsonLdProducts(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) out.push(record);
    if (record["@graph"]) visit(record["@graph"]);
  };
  for (const block of blocks) {
    const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      visit(JSON.parse(body));
    } catch {
      // сломанный JSON-LD у сайта — не повод падать
    }
  }
  return out;
}

/** Обычная HTML-страница товара: JSON-LD Product, затем og:-теги. */
export function extractHtmlProduct(html: string, pageUrl: string): ExtractedProduct {
  const ld = jsonLdProducts(html)[0];
  const ldImages = ld ? (Array.isArray(ld.image) ? ld.image : [ld.image]).map((i) => (typeof i === "string" ? i : (i as { url?: string })?.url ?? null)) : [];
  const brand = ld?.brand;
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
  return {
    sourceItemId: text(ld?.productID) ?? text(ld?.sku) ?? null,
    title: text(ld?.name) ?? text(metaContent(html, "og:title")[0]) ?? text(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]),
    brand: text(typeof brand === "string" ? brand : (brand as { name?: string })?.name),
    article: text(ld?.sku) ?? text(ld?.mpn),
    canonicalUrl: canonical ? new URL(decodeEntities(canonical), pageUrl).toString() : null,
    images: uniqueUrls([...ldImages, ...metaContent(html, "og:image"), ...metaContent(html, "twitter:image")], pageUrl),
    publishedAt: null,
    productType: text(ld?.category),
    colors: text(ld?.color) ? [text(ld?.color) as string] : [],
    newBadge: null,
  };
}

/** Запасное название, если сайт ничего не отдал: хост и последний сегмент адреса. */
export function fallbackTitle(raw: string): string {
  const url = new URL(raw);
  const tail = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ").replace(/\.\w+$/, "");
  return [url.hostname.replace(/^www\./, ""), tail].filter(Boolean).join(" · ");
}
