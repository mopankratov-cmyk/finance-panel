import type { SupabaseClient } from "@supabase/supabase-js";
import type { MappedRecord } from "./brightdataCatalog";
import { ingestRecords } from "./brightdataCrawl";
import { miniPhotoShop, nextSitemapState, parseShopCatalog, readSitemapState, RU_SHOPS, ruShopPageUrl, sitemapDiff, sitemapModelIds, type RuShop, type SitemapDiff } from "./ruShops";
import { sniffImageMime } from "@/lib/ctrtest/pinImage";
import { storeImages } from "./importer";
import { ASSORTMENT_BOT_UA, safeFetch } from "./safeFetch";
import { MAX_IMAGE_BYTES } from "./storage";

/** Пауза между страницами одного сайта — вежливо, не чаще запроса в секунду. */
const PAGE_PAUSE_MS = 1_200;
const PAGE_MAX_BYTES = 3_000_000;
const SITEMAP_MAX_BYTES = 8_000_000;

export interface RuShopResult {
  sourceId: string;
  name: string;
  ok: boolean;
  pages: number;
  collected: number;
  added: number;
  baseline: boolean;
  /** Новых моделей по карте сайта, ждущих появления в каталоге. */
  pending: number;
  /** Новые находки без фото: облаку их не отдали — принесёт загрузчик на mini. */
  missingPhotos: Array<{ referenceId: string; urls: string[] }>;
  error: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url: string, maxBytes: number): Promise<string> {
  const response = await safeFetch(url, { maxBytes, timeoutMs: 25_000, accept: "text/html,application/xml;q=0.9,*/*;q=0.5", userAgent: ASSORTMENT_BOT_UA });
  return response.body.toString("utf8");
}

async function ensureShop(db: SupabaseClient, shop: RuShop) {
  const { error } = await db.from("assortment_sources").upsert({
    source_id: shop.sourceId,
    name: shop.name,
    source_group: "Российские бренды",
    categories: [...new Set(shop.sections.map((s) => s.direction))],
    region: "Россия",
    priority: "P0",
    adapter_type: "Каталог сайта",
    access_status: "auto_verified",
    access_note: shop.accessNote,
    research_status: "Российские бренды",
    seed_urls: [shop.catalogBase],
  }, { onConflict: "source_id" });
  if (error) throw new Error(error.message);
}

/** Страница каталога: HTML или null — страниц больше нет (у загрузчика на mini кончились). */
type PageSource = (slug: string, page: number) => Promise<string | null>;

/** Страницы раздела подряд, пока не кончатся новые карточки; дошли до потолка — раздел обрезан. */
async function crawlSection(shop: RuShop, slug: string, deadline: number, getPage: PageSource): Promise<{ records: MappedRecord[]; pages: number; complete: boolean }> {
  const byUrl = new Map<string, MappedRecord>();
  let pages = 0;
  for (let page = 1; page <= shop.maxPages; page += 1) {
    if (Date.now() > deadline) return { records: [...byUrl.values()], pages, complete: false };
    const html = await getPage(slug, page);
    if (html === null) return { records: [...byUrl.values()], pages, complete: false };
    const cards = parseShopCatalog(shop, html);
    pages += 1;
    const fresh = cards.filter((c) => !byUrl.has(c.url));
    if (fresh.length === 0) return { records: [...byUrl.values()], pages, complete: true };
    for (const card of fresh) byUrl.set(card.url, card);
  }
  return { records: [...byUrl.values()], pages, complete: false };
}

/** Загрузка с Vercel: вежливая пауза между страницами одного сайта. */
function fetchPages(shop: RuShop): PageSource {
  return async (slug, page) => {
    if (page > 1) await sleep(PAGE_PAUSE_MS);
    return fetchText(ruShopPageUrl(shop, slug, page), PAGE_MAX_BYTES);
  };
}

/**
 * Обход магазина: страницы берёт `getPage` (сам Vercel или посылка загрузчика
 * с mini), разбор, база и новинки — здесь, одинаково для обоих путей.
 */
export async function crawlShop(db: SupabaseClient, shop: RuShop, deadline: number, getPage: PageSource = fetchPages(shop)): Promise<RuShopResult> {
  const result: RuShopResult = { sourceId: shop.sourceId, name: shop.name, ok: false, pages: 0, collected: 0, added: 0, baseline: false, pending: 0, missingPhotos: [], error: null };
  const now = new Date().toISOString();
  const warnings: string[] = [];
  try {
    await ensureShop(db, shop);
    const { data: row, error } = await db.from("assortment_sources").select("capabilities").eq("source_id", shop.sourceId).maybeSingle();
    if (error) throw new Error(error.message);
    const capabilities = (row?.capabilities && typeof row.capabilities === "object" ? row.capabilities : {}) as Record<string, unknown>;

    // Карта сайта — у тех, чей каталог отдаёт не всё (Lime).
    let models: Set<string> | null = null;
    let diff: SitemapDiff | null = null;
    if (shop.sitemapUrl) {
      models = sitemapModelIds(await fetchText(shop.sitemapUrl, SITEMAP_MAX_BYTES));
      if (models.size === 0) throw new Error("карта сайта пуста — разметка поменялась?");
      diff = sitemapDiff(readSitemapState(capabilities), models, now);
      if (diff.massChange) warnings.push("в карте сайта разом сотни новых моделей — похоже на перестройку сайта, обход лёг базой");
    }

    // Разделы одного направления (куртки, пальто…) — одна выборка: база и новинки по направлению.
    const byDirection = new Map<RuShop["sections"][number]["direction"], { records: MappedRecord[]; complete: boolean }>();
    const seen = new Set<string>();
    for (const section of shop.sections) {
      const crawled = await crawlSection(shop, section.slug, deadline, getPage);
      result.pages += crawled.pages;
      crawled.records.forEach((r) => seen.add(r.sourceItemId));
      if (!crawled.complete) warnings.push(`раздел ${section.slug}: обход не дошёл до конца (${crawled.pages} стр.)`);
      const bucket = byDirection.get(section.direction) ?? { records: [], complete: true };
      bucket.records.push(...crawled.records);
      bucket.complete = bucket.complete && crawled.complete;
      byDirection.set(section.direction, bucket);
    }
    for (const [direction, bucket] of byDirection) {
      const done = await ingestRecords(db, { sourceId: shop.sourceId, name: shop.name }, { direction, method: shop.method }, bucket.records, deadline, diff
        ? { quiet: diff.baseline || diff.massChange, freshOnly: diff.fresh, cloudPhotos: shop.via !== "mini", drainOrphans: true }
        // Полный обход — новинка как у Shopify; не дошли до конца — новинкам не верим.
        : { quiet: !bucket.complete, churnGuard: true, cloudPhotos: shop.via !== "mini", drainOrphans: true });
      if (done.churn) warnings.push(`${direction === "bags" ? "сумки" : "куртки"}: слишком много новых разом — похоже на перестройку каталога, обход лёг базой`);
      result.collected += done.collected;
      result.added += done.added;
      result.baseline = result.baseline || done.baseline;
      result.missingPhotos.push(...done.missingPhotos);
    }

    const next = models && diff ? nextSitemapState(models, diff, seen) : null;
    result.pending = next ? Object.keys(next.pending).length : 0;
    const patch: Record<string, unknown> = {
      capabilities: next ? { ...capabilities, sitemap: next } : capabilities,
      last_attempt_at: now,
      last_error: warnings.length ? warnings.join("; ") : null,
    };
    if (result.collected > 0) patch.last_success_at = now;
    const { error: saveError } = await db.from("assortment_sources").update(patch).eq("source_id", shop.sourceId);
    if (saveError) throw new Error(saveError.message);
    result.ok = true;
    result.error = warnings.length ? warnings.join("; ") : null;
  } catch (error) {
    result.error = error instanceof Error ? error.message.slice(0, 200) : "обход не удался";
    await db.from("assortment_sources").update({ last_attempt_at: now, last_error: result.error }).eq("source_id", shop.sourceId);
  }
  return result;
}

/**
 * Обход сайтов российских брендов. Плановый — только в дни магазина;
 * `only` (ручной запуск одного источника) — в любой день. Магазины, которые
 * облако не пускает (`via: "mini"`), приносит загрузчик на mini — здесь их нет.
 */
export async function runRuShopsCrawl(db: SupabaseClient, deadline: number, only?: string | null): Promise<RuShopResult[]> {
  const today = new Date().getUTCDay();
  const results: RuShopResult[] = [];
  for (const shop of RU_SHOPS) {
    if (shop.via === "mini") continue;
    if (only ? shop.sourceId !== only : !shop.weekdaysUtc.includes(today)) continue;
    if (Date.now() > deadline) break;
    results.push(await crawlShop(db, shop, deadline));
  }
  return results;
}

export class MiniPhotoError extends Error {}

/**
 * Фото новой находки, принесённое загрузчиком на mini: только для находки
 * магазина «via: mini», созданной обходом и ещё без единого фото, и только с
 * CDN этого магазина. Байты проверяются как картинка.
 */
export async function attachMiniPhoto(db: SupabaseClient, input: { referenceId: unknown; url: unknown; bytes: Buffer }): Promise<number> {
  if (typeof input.referenceId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.referenceId)) throw new MiniPhotoError("Неверная находка");
  const { data: ref, error } = await db.from("assortment_references").select("id,source_id,created_by").eq("id", input.referenceId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!ref || ref.created_by !== "crawler" || !miniPhotoShop(ref.source_id, input.url)) throw new MiniPhotoError("Фото не для этой находки");
  const { count, error: countError } = await db.from("assortment_media").select("id", { count: "exact", head: true }).eq("reference_id", input.referenceId);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) return 0;
  if (input.bytes.length === 0 || input.bytes.length > MAX_IMAGE_BYTES) throw new MiniPhotoError("Фото пустое или больше 10 МБ");
  const mime = sniffImageMime(input.bytes);
  if (!mime) throw new MiniPhotoError("Это не картинка");
  return storeImages(db, input.referenceId, [{ bytes: input.bytes, mime, originUrl: String(input.url), uploadPath: null }], false);
}
