/**
 * Разбор карточек каталога российских брендов — по одному правилу на сайт
 * (разметка снята 04.10.2026 с открытых роботам страниц). Берём только
 * ссылку, название, фото и номер модели; цены рядом не читаем. Цвета одной
 * модели дают один номер — их схлопнет общий приём записей.
 */

import type { MappedRecord } from "./brightdataCatalog";

export const decodeHtml = (text: string) => text
  .replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const record = (sourceItemId: string, url: string, title: string, brand: string, images: string[]): MappedRecord => ({
  sourceItemId, url, title, brand, category: "", color: null, images: images.filter((src) => /^https?:\/\//.test(src)).slice(0, 4), reviews: null, rating: null,
});

/**
 * befree: у каждой карточки своя разметка schema.org Product (ld+json) —
 * ссылка `/zhenskaya/product/BF2645457020/20` (модель / цвет), название, фото.
 * Фото CDN отдаёт и в 1 280 px.
 */
export function parseBefree(html: string): MappedRecord[] {
  const out: MappedRecord[] = [];
  for (const match of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const product = data as { "@type"?: unknown; url?: unknown; name?: unknown; image?: unknown };
    if (product?.["@type"] !== "Product" || typeof product.url !== "string" || typeof product.name !== "string") continue;
    const id = product.url.match(/\/product\/([A-Z0-9]+)\//i)?.[1];
    if (!id) continue;
    const images = (Array.isArray(product.image) ? product.image : [product.image]).filter((i): i is string => typeof i === "string")
      .map((src) => src.replace(/\/images\/(?:320|640)\//, "/images/1280/"));
    out.push(record(id.toUpperCase(), product.url, decodeHtml(product.name), "befree", images));
  }
  return out;
}

/**
 * Love Republic: `<article class="catalog-item">` — фото с названием в alt,
 * ссылка `catalog-item-link`, артикул в `itemprop="sku"` («644920065-22» —
 * модель и цвет). Число в ссылке — внутренний номер сайта, моделью не берём.
 */
export function parseLoveRepublic(html: string, origin = "https://loverepublic.ru"): MappedRecord[] {
  const out: MappedRecord[] = [];
  for (const block of html.split(/<article class="catalog-item"/).slice(1)) {
    const card = block.split("</article>")[0];
    const img = card.match(/<img src="(https:\/\/[^"]+)" alt="([^"]*)"/);
    const link = card.match(/<a href="(\/catalog\/[^"]+\/\d+\/)" class="catalog-item-link"/);
    const sku = card.match(/itemprop="sku" content="([^"]+)"/)?.[1];
    if (!img || !link) continue;
    const id = sku?.split("-")[0] || link[1].match(/\/(\d+)\/$/)?.[1];
    const title = decodeHtml(img[2]);
    if (!id || !title) continue;
    out.push(record(id, `${origin}${link[1]}`, title, "Love Republic", [img[1]]));
  }
  return out;
}

/**
 * ZARINA: ссылка `/catalog/product/ZR2611061704-20/` (модель — до дефиса),
 * название — текст второй ссылки на тот же адрес, фото — первая картинка
 * карточки на imgcdn.zarina.ru.
 */
export function parseZarina(html: string, origin = "https://zarina.ru"): MappedRecord[] {
  const images = new Map<string, string>();
  for (const match of html.matchAll(/href="\/catalog\/product\/(ZR[0-9A-Z]+-\d+)\/"><div class="product-media[\s\S]{0,800}?src="(https:\/\/imgcdn\.zarina\.ru\/[^"]+)"/g)) {
    if (!images.has(match[1])) images.set(match[1], match[2].replace(/&amp;/g, "&"));
  }
  const out: MappedRecord[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a[^>]*href="(\/catalog\/product\/((ZR[0-9A-Z]+)-\d+)\/)"[^>]*>([^<]{2,200})<\/a>/g)) {
    const [, path, key, model, rawTitle] = match;
    if (seen.has(key)) continue;
    seen.add(key);
    const image = images.get(key);
    out.push(record(model, `${origin}${path}`, decodeHtml(rawTitle), "ZARINA", image ? [image] : []));
  }
  return out;
}

/**
 * Sela: данные карточки в атрибуте `data-p` (JSON: url «SL6809163202_20» —
 * модель и цвет, name, category, image[]), ссылка `product-thumb_lnk`. Сайт
 * сам помечает новинки стикером «Новинка» — пока не используем.
 */
export function parseSela(html: string, origin = "https://www.sela.ru"): MappedRecord[] {
  const out: MappedRecord[] = [];
  for (const block of html.split(/<div class="product-thumb product-thumb_/).slice(1)) {
    const raw = block.match(/data-p='([^']+)'/)?.[1];
    if (!raw) continue;
    let data: { url?: unknown; name?: unknown; image?: unknown };
    try {
      data = JSON.parse(raw.replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/&amp;/g, "&"));
    } catch {
      continue;
    }
    if (typeof data.url !== "string" || typeof data.name !== "string") continue;
    const id = data.url.split("_")[0];
    const link = block.match(/href="([^"]*\/[^"]*)"[^>]*class="product-thumb_lnk|class="product-thumb_lnk[^"]*"[^>]*href="([^"]+)"/);
    const path = link?.[1] || link?.[2];
    if (!id || !path) continue;
    const images = (Array.isArray(data.image) ? data.image : []).filter((i): i is string => typeof i === "string");
    const best = images.find((src) => src.includes("@2x")) ?? images[0];
    out.push(record(id, path.startsWith("http") ? path : `${origin}${path}`, decodeHtml(data.name), "Sela", best ? [best] : []));
  }
  return out;
}

/**
 * Pompa: `<article class="product-card" data-product-id data-articul
 * data-name="Сумка-хобо - 1162747" data-category>`; ссылка
 * `/catalog/product/<id>/`, фото — первая картинка из /upload/. Модель —
 * число в начале артикула («1016561p90068» → 1016561), цена из `data-price`
 * не читается.
 */
export function parsePompa(html: string, origin = "https://www.pompa.ru"): MappedRecord[] {
  const out: MappedRecord[] = [];
  for (const block of html.split(/<article class="product-card/).slice(1)) {
    const card = block.split("</article>")[0];
    const productId = card.match(/data-product-id="(\d+)"/)?.[1];
    const articul = card.match(/data-articul="([^"]+)"/)?.[1];
    const name = card.match(/data-name="([^"]+)"/)?.[1];
    const link = card.match(/href="(\/catalog\/product\/\d+\/)"/)?.[1];
    const image = card.match(/(?:data-src|src)="(\/upload\/[^"]+\.(?:jpe?g|png|webp))"/i)?.[1];
    const id = articul?.match(/^(\d{5,})/)?.[1] ?? productId;
    if (!id || !name || !link) continue;
    const title = decodeHtml(name).replace(/\s+-\s+\d+$/, "");
    out.push(record(id, `${origin}${link}`, title, "POMPA", image ? [`${origin}${image}`] : []));
  }
  return out;
}
