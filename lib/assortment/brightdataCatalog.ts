/**
 * Сбор новинок через Bright Data (ASOS, H&M) — 2 раза в неделю, ср и сб
 * (решение владельца 02.10.2026). Чистые функции: цели сбора, разбор записей,
 * состояние запущенных проб.
 *
 * Только готовые сборщики Bright Data; цены вырезаются ещё в stripMoney.
 */

import type { AssortmentDirection } from "./constants";
import type { CatalogItem } from "./crawl";

export interface CollectionTarget {
  sourceId: string;
  datasetId: string;
  direction: AssortmentDirection;
  discoverBy: "keyword" | "category";
  inputs: Array<Record<string, string>>;
  limitPerInput: number;
  method: string;
}

/**
 * ASOS — по запросам (раздел новинок с параметром в адресе сборщик не берёт);
 * H&M — по разделу (`category_url`). Около 160 записей за прогон.
 */
export const BRIGHTDATA_TARGETS: CollectionTarget[] = [
  {
    sourceId: "S046", datasetId: "gd_ldbg7we91cp53nr2z4", direction: "bags", discoverBy: "keyword", limitPerInput: 10, method: "brightdata_asos",
    inputs: ["hobo bag", "shoulder bag", "crossbody bag", "tote bag"].map((keyword) => ({ keyword })),
  },
  {
    sourceId: "S046", datasetId: "gd_ldbg7we91cp53nr2z4", direction: "jackets", discoverBy: "keyword", limitPerInput: 10, method: "brightdata_asos",
    inputs: ["bomber jacket", "puffer jacket", "trench coat", "leather jacket"].map((keyword) => ({ keyword })),
  },
  {
    sourceId: "S007", datasetId: "gd_lebec5ir293umvxh5g", direction: "bags", discoverBy: "category", limitPerInput: 40, method: "brightdata_hm",
    inputs: [{ category_url: "https://www2.hm.com/en_us/women/products/bags.html" }],
  },
  {
    sourceId: "S007", datasetId: "gd_lebec5ir293umvxh5g", direction: "jackets", discoverBy: "category", limitPerInput: 40, method: "brightdata_hm",
    inputs: [{ category_url: "https://www2.hm.com/en_us/women/products/jackets-coats.html" }],
  },
];

export interface PendingSnapshot {
  snapshotId: string;
  datasetId: string;
  direction: AssortmentDirection;
  method: string;
  triggeredAt: string;
}

/** Запущенные пробы хранятся в capabilities источника — отдельной таблицы не заводим. */
export function readPending(capabilities: unknown): PendingSnapshot[] {
  const list = (capabilities as { brightdata_pending?: unknown } | null)?.brightdata_pending;
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is PendingSnapshot =>
    Boolean(p) && typeof p.snapshotId === "string" && typeof p.datasetId === "string"
    && (p.direction === "bags" || p.direction === "jackets") && typeof p.triggeredAt === "string");
}

export function writePending(capabilities: unknown, pending: PendingSnapshot[]): Record<string, unknown> {
  const base = capabilities && typeof capabilities === "object" && !Array.isArray(capabilities) ? { ...(capabilities as Record<string, unknown>) } : {};
  base.brightdata_pending = pending;
  return base;
}

/** Проба висит дольше суток — её уже не ждём. */
export const PENDING_TTL_MS = 24 * 3600 * 1000;

export interface MappedRecord {
  sourceItemId: string;
  url: string;
  title: string;
  brand: string | null;
  category: string;
  color: string | null;
  images: string[];
  reviews: number | null;
  rating: number | null;
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const first = (record: Record<string, unknown>, keys: string[]) => keys.map((k) => record[k]).find((v) => v !== undefined && v !== null && v !== "");

function imageList(record: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//.test(value) && !out.includes(value)) out.push(value);
    if (Array.isArray(value)) value.forEach(push);
  };
  for (const key of ["main_image", "image", "image_url", "image_urls", "additional_image_urls", "images"]) push(record[key]);
  return out.slice(0, 4);
}

/** Запись Bright Data (ASOS или H&M) → поля находки. Ошибочные и без ссылки — null. */
export function mapRecord(raw: unknown): MappedRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.error) return null;
  const url = str(first(record, ["url", "product_url"]));
  const title = str(first(record, ["name", "product_name", "title"]));
  if (!url || !title || !/^https?:\/\//.test(url)) return null;
  const id = first(record, ["product_id", "product_code", "sku", "SKU", "id"]);
  const brandRaw = first(record, ["brand", "brand_name"]);
  const brand = typeof brandRaw === "string" ? brandRaw.trim() : str((brandRaw as { name?: unknown } | undefined)?.name);
  const categoryRaw = first(record, ["category", "product_category"]);
  return {
    sourceItemId: id != null ? String(id) : url.split("?")[0],
    url: url.split("?")[0],
    title,
    brand: brand || null,
    category: typeof categoryRaw === "string" ? categoryRaw : Array.isArray(categoryRaw) ? categoryRaw.map(String).join(" / ") : "",
    color: str(first(record, ["color"])),
    images: imageList(record),
    reviews: num(first(record, ["review_count", "reviews_count", "rating_count"])),
    rating: num(first(record, ["star_rating", "rating"])),
  };
}

export function asCatalogItem(record: MappedRecord): CatalogItem {
  return { sourceItemId: record.sourceItemId, handle: record.url, title: record.title, productType: record.category, tags: [], publishedAt: null };
}
