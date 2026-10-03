import type { SupabaseClient } from "@supabase/supabase-js";
import type { MappedRecord } from "./brightdataCatalog";
import { ingestRecords } from "./brightdataCrawl";
import { nextSitemapState, parseLimeCatalog, readSitemapState, RU_SHOPS, ruShopPageUrl, sitemapDiff, sitemapModelIds, type RuShop } from "./ruShops";
import { ASSORTMENT_BOT_UA, safeFetch } from "./safeFetch";

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

/** Страницы раздела подряд, пока не кончатся новые карточки; дошли до потолка — раздел обрезан. */
async function crawlSection(shop: RuShop, slug: string, deadline: number): Promise<{ records: MappedRecord[]; pages: number; complete: boolean }> {
  const byUrl = new Map<string, MappedRecord>();
  let pages = 0;
  for (let page = 1; page <= shop.maxPages; page += 1) {
    if (Date.now() > deadline) return { records: [...byUrl.values()], pages, complete: false };
    if (page > 1) await sleep(PAGE_PAUSE_MS);
    const cards = parseLimeCatalog(await fetchText(ruShopPageUrl(shop, slug, page), PAGE_MAX_BYTES));
    pages += 1;
    const fresh = cards.filter((c) => !byUrl.has(c.url));
    if (fresh.length === 0) return { records: [...byUrl.values()], pages, complete: true };
    for (const card of fresh) byUrl.set(card.url, card);
  }
  return { records: [...byUrl.values()], pages, complete: false };
}

async function crawlShop(db: SupabaseClient, shop: RuShop, deadline: number): Promise<RuShopResult> {
  const result: RuShopResult = { sourceId: shop.sourceId, name: shop.name, ok: false, pages: 0, collected: 0, added: 0, baseline: false, pending: 0, error: null };
  const now = new Date().toISOString();
  const warnings: string[] = [];
  try {
    await ensureShop(db, shop);
    const { data: row, error } = await db.from("assortment_sources").select("capabilities").eq("source_id", shop.sourceId).maybeSingle();
    if (error) throw new Error(error.message);
    const capabilities = (row?.capabilities && typeof row.capabilities === "object" ? row.capabilities : {}) as Record<string, unknown>;

    const models = sitemapModelIds(await fetchText(shop.sitemapUrl, SITEMAP_MAX_BYTES));
    if (models.size === 0) throw new Error("карта сайта пуста — разметка поменялась?");
    const diff = sitemapDiff(readSitemapState(capabilities), models, now);
    if (diff.massChange) warnings.push("в карте сайта разом сотни новых моделей — похоже на перестройку сайта, обход лёг базой");

    const seen = new Set<string>();
    for (const section of shop.sections) {
      const crawled = await crawlSection(shop, section.slug, deadline);
      result.pages += crawled.pages;
      crawled.records.forEach((r) => seen.add(r.sourceItemId));
      if (!crawled.complete) warnings.push(`раздел ${section.slug}: обход не дошёл до конца (${crawled.pages} стр.)`);
      const done = await ingestRecords(db, { sourceId: shop.sourceId, name: shop.name }, { direction: section.direction, method: shop.method }, crawled.records, deadline, {
        quiet: diff.baseline || diff.massChange,
        freshOnly: diff.fresh,
      });
      result.collected += done.collected;
      result.added += done.added;
      result.baseline = result.baseline || done.baseline;
    }

    const next = nextSitemapState(models, diff, seen);
    result.pending = Object.keys(next.pending).length;
    const patch: Record<string, unknown> = {
      capabilities: { ...capabilities, sitemap: next },
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
 * Обход сайтов российских брендов (Lime). Плановый — только в дни магазина;
 * `only` (ручной запуск одного источника) — в любой день.
 */
export async function runRuShopsCrawl(db: SupabaseClient, deadline: number, only?: string | null): Promise<RuShopResult[]> {
  const today = new Date().getUTCDay();
  const results: RuShopResult[] = [];
  for (const shop of RU_SHOPS) {
    if (only ? shop.sourceId !== only : !shop.weekdaysUtc.includes(today)) continue;
    if (Date.now() > deadline) break;
    results.push(await crawlShop(db, shop, deadline));
  }
  return results;
}
