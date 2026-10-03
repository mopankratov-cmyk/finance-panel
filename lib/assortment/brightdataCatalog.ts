/**
 * Сбор новинок через Bright Data: ASOS и H&M — сборщиками 2 раза в неделю, ср
 * и сб (решение владельца 02.10.2026); Zara и Uniqlo — готовыми наборами по
 * средам. Чистые функции: цели сбора, разбор записей, состояние проб.
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
  /**
   * «dataset» — готовый набор Bright Data (собирают они, мы покупаем выборку
   * по фильтру, $2.5 за 1 000 записей) вместо запуска сборщика.
   */
  kind?: "collect" | "dataset";
  filter?: unknown;
  /**
   * Потолок выборки набора. Раздел обязан влезать целиком: новинка — то, чего
   * не было в прошлых выборках, и обрезанная выборка выдаёт за новинки старые
   * вещи, не попавшие в прошлый раз. Пришло ровно столько, сколько потолок, —
   * раздел считаем обрезанным и новинок из него не показываем.
   */
  recordsLimit?: number;
  /** Запускать только в этот день недели (UTC, 0 — вс): наборы обновляются нечасто. */
  weekdayUtc?: number;
  /** Раздел задан фильтром набора — названия на разных языках, словарём не проверяем. */
  trustDirection?: boolean;
}

/**
 * Zara: свой сборщик Bright Data ломается на разборе карточки, а готовый набор
 * «Zara - Products» работает (проба 03.10). Семейства — внутренние коды Zara:
 * CAZADORA — куртки, ABRIGO — пальто, GABARDINA — тренчи, PLUMIFERO —
 * пуховики, BOLSO — сумки. CHAQUETA не берём: там кардиганы. Одна витрина
 * (США, английский): товар в наборе повторяется по странам, и раздел всех
 * витрин в выборку целиком не влезает. Записи — модель в цвете; набор хранит
 * и распроданное (`availability: false`): куртки одной витрины не влезли и в
 * 600 записей (03.10), поэтому в куртках только то, что в продаже.
 */
const ZARA_US = { name: "url", operator: "includes", value: "/us/en/" };
const ZARA_IN_STOCK = { name: "availability", operator: "=", value: true };
const zaraFilter = (families: string[], extra: unknown[] = []) => ({
  operator: "and",
  filters: [{ name: "section", operator: "=", value: "WOMAN" }, { name: "product_family", operator: "in", value: families }, ZARA_US, ...extra],
});

/**
 * Uniqlo: готовый набор «Uniqlo Products» (проба 03.10) — запись на каждый
 * цвет и размер, номер модели в group_id, пол и раздел в product_category
 * («WOMEN > Outerwear > …»). Витрина одна — Испания, на английском. Куртки —
 * только размер S (item_id «…-003»), иначе одна модель — десяток записей;
 * жакеты-блейзеры не берём: это не верхняя одежда.
 */
const UNIQLO_SPAIN = { name: "store_country", operator: "=", value: "ES" };
const uniqloFilter = (category: string, extra: unknown[] = []) => ({
  operator: "and",
  filters: [UNIQLO_SPAIN, { name: "product_category", operator: "includes", value: category }, ...extra],
});

/**
 * ASOS — по запросам (раздел новинок с параметром в адресе сборщик не берёт),
 * включая Mango; H&M — по разделу (`category_url`). Около 180 записей за прогон.
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
  // Mango своих новинок через Bright Data не отдаёт (сборщик только по ссылкам),
  // а ASOS Mango продаёт — берём его выдачу по бренду (живая проба 02.10).
  {
    sourceId: "S046", datasetId: "gd_ldbg7we91cp53nr2z4", direction: "bags", discoverBy: "keyword", limitPerInput: 10, method: "brightdata_asos",
    inputs: [{ keyword: "mango bag" }],
  },
  {
    sourceId: "S046", datasetId: "gd_ldbg7we91cp53nr2z4", direction: "jackets", discoverBy: "keyword", limitPerInput: 10, method: "brightdata_asos",
    inputs: [{ keyword: "mango jacket" }],
  },
  {
    sourceId: "S001", datasetId: "gd_lct4vafw1tgx27d4o0", direction: "jackets", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_zara",
    kind: "dataset", filter: zaraFilter(["CAZADORA", "ABRIGO", "GABARDINA", "PLUMIFERO", "PARKA"], [ZARA_IN_STOCK]), recordsLimit: 600, weekdayUtc: 3, trustDirection: true,
  },
  {
    sourceId: "S001", datasetId: "gd_lct4vafw1tgx27d4o0", direction: "bags", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_zara",
    kind: "dataset", filter: zaraFilter(["BOLSO", "BOLSOS"]), recordsLimit: 300, weekdayUtc: 3, trustDirection: true,
  },
  {
    sourceId: "S003", datasetId: "gd_mosh3s7wdb7jafn85", direction: "jackets", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_uniqlo",
    kind: "dataset", recordsLimit: 400, weekdayUtc: 3, trustDirection: true,
    filter: uniqloFilter("WOMEN > Outerwear", [
      { name: "product_category", operator: "not_includes", value: "Blazers" },
      { name: "item_id", operator: "includes", value: "-003" },
    ]),
  },
  {
    sourceId: "S003", datasetId: "gd_mosh3s7wdb7jafn85", direction: "bags", discoverBy: "category", inputs: [], limitPerInput: 0, method: "brightdata_uniqlo",
    kind: "dataset", recordsLimit: 300, weekdayUtc: 3, trustDirection: true,
    filter: uniqloFilter("WOMEN > Accessories > Bags"),
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
  kind?: "collect" | "dataset";
  trustDirection?: boolean;
  /** Для выборки набора: потолок и отпечаток фильтра — проверить полноту и смену охвата. */
  recordsLimit?: number;
  coverage?: string;
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

/** Раздел набора в capabilities: набор + раздел (у источника их бывает несколько). */
export function coverageKey(target: { datasetId: string; direction: AssortmentDirection }): string {
  return `${target.datasetId}|${target.direction}`;
}

/** Отпечаток фильтра: сменился фильтр — сменился охват раздела. */
export function filterSignature(filter: unknown): string {
  const text = JSON.stringify(filter ?? null);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function readCoverage(capabilities: unknown): Record<string, string> {
  const map = (capabilities as { brightdata_coverage?: unknown } | null)?.brightdata_coverage;
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  return Object.fromEntries(Object.entries(map as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
}

export function writeCoverage(capabilities: Record<string, unknown>, coverage: Record<string, string>): Record<string, unknown> {
  return { ...capabilities, brightdata_coverage: coverage };
}

export interface DatasetVerdict {
  /** Новинки из выборки не показываем: раздел обрезан или только что сменил охват. */
  quiet: boolean;
  /** Запомнить охват раздела — выборка полная. */
  remember: boolean;
  warning: string | null;
}

/**
 * Можно ли верить новинкам выборки набора. Пришло столько, сколько потолок, —
 * раздел обрезан: новинки там случайные. Фильтр сменился (или охват ещё не
 * запомнен) — этот сбор становится базой раздела, новинки пойдут со следующего.
 */
export function datasetVerdict(rows: number, snapshot: Pick<PendingSnapshot, "recordsLimit" | "coverage" | "direction">, stored: string | undefined): DatasetVerdict {
  const truncated = snapshot.recordsLimit !== undefined && rows >= snapshot.recordsLimit;
  if (truncated) {
    return { quiet: true, remember: false, warning: `раздел «${snapshot.direction === "bags" ? "сумки" : "куртки"}» больше потолка выборки (${rows}) — новинки не показываем, нужен фильтр уже или потолок выше` };
  }
  const changed = snapshot.coverage !== undefined && stored !== snapshot.coverage;
  return { quiet: changed, remember: snapshot.coverage !== undefined, warning: null };
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

/**
 * Фото магазинов — в высоком разрешении. Bright Data отдаёт ссылки ASOS с
 * пресетом превью (`$n_240w$&wid=44` — 44 пикселя в ширину) или без
 * параметров (маленькое превью по умолчанию): 03.10 карточки в ленте были
 * размытыми. CDN магазинов сами отдают нужный размер по параметру.
 */
export function hiResImageUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.hostname === "images.asos-media.com") {
      url.search = "";
      return `${url.toString()}?$n_1920w$&wid=1200&fit=constrain`;
    }
    if (url.hostname === "image.hm.com" || url.hostname.endsWith(".hm.com")) {
      url.searchParams.set("imwidth", "1200");
      return url.toString();
    }
    if (url.hostname === "image.uniqlo.com") {
      url.searchParams.set("width", "1200");
      return url.toString();
    }
    return raw;
  } catch {
    return raw;
  }
}

function imageList(record: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//.test(value)) {
      const url = hiResImageUrl(value);
      if (!out.includes(url)) out.push(url);
    }
    if (Array.isArray(value)) value.forEach(push);
  };
  for (const key of ["main_image", "image", "image_url", "image_urls", "additional_image_urls", "images"]) push(record[key]);
  return out.slice(0, 4);
}

/** Запись Bright Data (ASOS, H&M, Zara, Uniqlo) → поля находки. Ошибочные и без ссылки — null. */
export function mapRecord(raw: unknown): MappedRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.error) return null;
  const url = str(first(record, ["url", "product_url"]));
  const title = str(first(record, ["name", "product_name", "title"]));
  if (!url || !title || !/^https?:\/\//.test(url)) return null;
  // group_id — модель Uniqlo: в наборе запись на каждый цвет и размер.
  const id = first(record, ["product_id", "product_code", "sku", "SKU", "id", "group_id"]);
  const brandRaw = first(record, ["brand", "brand_name"]);
  const brand = typeof brandRaw === "string" ? brandRaw.trim() : str((brandRaw as { name?: unknown } | undefined)?.name);
  const categoryRaw = first(record, ["category", "product_category", "product_family"]);
  return {
    sourceItemId: id != null ? String(id) : url.split("?")[0],
    url: url.split("?")[0],
    title,
    brand: brand || null,
    category: typeof categoryRaw === "string" ? categoryRaw : Array.isArray(categoryRaw) ? categoryRaw.map(String).join(" / ") : "",
    color: str(first(record, ["color", "colour"])),
    images: imageList(record),
    reviews: num(first(record, ["review_count", "reviews_count", "rating_count"])),
    rating: num(first(record, ["star_rating", "rating"])),
  };
}

/**
 * Одна вещь — одна запись. В наборе Zara товар повторяется по странам витрины
 * (us/en, uk/en…), а запись в базу одним пакетом не переносит один номер
 * дважды — 03.10 первый сбор Zara упал именно на этом. Оставляем первую
 * запись, но с фото, если у первой их не было.
 */
export function uniqueRecords(records: MappedRecord[]): MappedRecord[] {
  const byId = new Map<string, MappedRecord>();
  for (const record of records) {
    const seen = byId.get(record.sourceItemId);
    if (!seen || (seen.images.length === 0 && record.images.length > 0)) byId.set(record.sourceItemId, record);
  }
  return [...byId.values()];
}

export function asCatalogItem(record: MappedRecord): CatalogItem {
  return { sourceItemId: record.sourceItemId, handle: record.url, title: record.title, productType: record.category, tags: [], publishedAt: null };
}
