import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssortmentDirection } from "./constants";
import { catalogUrl, classifyItem, collectionHandles, collectionUrl, crawlPlan, isShopifyCrawlable, MAX_CATALOG_PAGES, mergeCatalog, parseCatalogPage, productUrl, CATALOG_PAGE_SIZE, type CatalogItem } from "./crawl";
import { isMissingAssortmentSchema, isMissingColumnError } from "./errors";
import { importReference } from "./importer";
import { modelKey, newModelsOnly } from "./modelKey";
import { recordObservation, type SnapshotItem } from "./observationLog";
import { safeFetch, SafeFetchError } from "./safeFetch";
import { catalogFields, loadKnownModelKeys, upsertSourceItems } from "./sourceItems";

/** Новых моделей на источник за прогон: остальное — очередь на следующий. */
const NEW_PER_SOURCE = 8;

export interface SourceCrawlResult {
  sourceId: string;
  name: string;
  ok: boolean;
  fetched: number;
  relevant: number;
  baseline: boolean;
  added: number;
  queued: number;
  error: string | null;
}

export class CrawlTableMissingError extends Error {
  constructor() {
    super("Таблица обхода не создана: нужно применить миграцию 202610020002_assortment_catalog_crawl.sql.");
  }
}

type SourceRow = { source_id: string; name: string; categories: string[]; access_status: string; access_note: string | null; seed_urls: string[] };

/** Чем закончился обход страниц: дошли до конца каталога, упёрлись в потолок страниц или в дедлайн. */
export type PagesEnd = "end" | "cap" | "deadline";

async function fetchPages(urlFor: (page: number) => string, maxPages: number, deadline: number): Promise<{ items: CatalogItem[]; end: PagesEnd }> {
  const items: CatalogItem[] = [];
  for (let page = 1; page <= maxPages; page++) {
    if (Date.now() > deadline) return { items, end: "deadline" };
    const response = await safeFetch(urlFor(page), { maxBytes: 12 * 1024 * 1024, timeoutMs: 20_000, accept: "application/json" });
    const batch = parseCatalogPage(JSON.parse(response.body.toString("utf8")));
    items.push(...batch);
    if (batch.length < CATALOG_PAGE_SIZE) return { items, end: "end" };
    await new Promise((r) => setTimeout(r, 800));
  }
  // Все страницы полные: каталог может быть больше потолка — мы видим только его начало.
  return { items, end: "cap" };
}

/**
 * Полнота обхода каталога — от неё зависит доверие к «появилось/пропало»:
 * full — дошли до конца; window — упёрлись в потолок страниц (каталог больше,
 * у JW PEI больше двух тысяч товаров; новинки видны через коллекции); partial —
 * оборвались по дедлайну.
 */
export function coverageOf(end: PagesEnd): "full" | "window" | "partial" {
  return end === "end" ? "full" : end === "cap" ? "window" : "partial";
}

/**
 * Коллекции новинок из паспорта + весь каталог до предела страниц. Каталог
 * бывает больше предела (у JW PEI — больше 2000 товаров), и новинки за ним
 * видны только через коллекции. Недоступная коллекция не роняет обход.
 */
async function fetchCatalog(seed: string, note: string | null, deadline: number): Promise<{ items: CatalogItem[]; end: PagesEnd }> {
  const collections: CatalogItem[][] = [];
  for (const handle of collectionHandles(note)) {
    try {
      collections.push((await fetchPages((page) => collectionUrl(seed, handle, page), 2, deadline)).items);
    } catch {
      // коллекцию переименовали или закрыли — весь каталог всё равно обойдём
    }
  }
  const all = await fetchPages((page) => catalogUrl(seed, page), MAX_CATALOG_PAGES, deadline);
  return { items: mergeCatalog(...collections, all.items), end: all.end };
}

async function knownIds(db: SupabaseClient, sourceId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("assortment_source_items").select("source_item_id").eq("source_id", sourceId).range(from, from + 999);
    if (error) {
      if (isMissingAssortmentSchema(error) || /assortment_source_items/.test(error.message)) throw new CrawlTableMissingError();
      throw new Error(error.message);
    }
    for (const row of data ?? []) ids.add(String(row.source_item_id));
    if (!data || data.length < 1000) return ids;
  }
}

async function markSource(db: SupabaseClient, sourceId: string, ok: boolean, error: string | null) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_attempt_at: now, last_error: error };
  if (ok) patch.last_success_at = now;
  const { error: updateError } = await db.from("assortment_sources").update(patch).eq("source_id", sourceId);
  if (updateError && isMissingColumnError(updateError) && ok) {
    await db.from("assortment_sources").update({ last_success_at: now }).eq("source_id", sourceId);
  }
}

async function crawlSource(db: SupabaseClient, source: SourceRow, deadline: number): Promise<SourceCrawlResult> {
  const result: SourceCrawlResult = { sourceId: source.source_id, name: source.name, ok: false, fetched: 0, relevant: 0, baseline: false, added: 0, queued: 0, error: null };
  const seed = source.seed_urls.find((s) => /^https?:\/\//.test(s))!;
  const categories = source.categories.filter((c): c is AssortmentDirection => c === "jackets" || c === "bags");
  try {
    const known = await knownIds(db, source.source_id);
    const catalog = await fetchCatalog(seed, source.access_note, deadline);
    const fetched = catalog.items;
    result.fetched = fetched.length;
    // Полнота обхода: дедлайн — partial, потолок страниц — window, конец каталога — full.
    const coverage = coverageOf(catalog.end);
    if (fetched.length === 0) throw new Error("каталог пуст — сайт мог сменить устройство");
    const plan = crawlPlan(known, fetched);
    result.baseline = plan.baseline;
    const now = new Date().toISOString();
    // Новинка — новая МОДЕЛЬ: расцветка уже известной модели (у Shopify — отдельный товар) ложится базой, а не отдельной находкой.
    const knownModels = plan.baseline ? new Set<string>() : await loadKnownModelKeys(db, source.source_id);
    const split = newModelsOnly(plan.fresh, (i) => modelKey({ sourceId: source.source_id, sourceItemId: i.sourceItemId, title: i.title }), knownModels);
    const fresh = new Set(split.fresh.map((i) => i.sourceItemId));
    const late = new Set([...plan.late, ...split.sameModel].map((i) => i.sourceItemId));
    // Новые вставляются со своим флагом базы, известные только обновляют
    // last_seen_at и описание. Две пачки, потому что supabase-js в пачке с
    // разным набором полей проставит отсутствующие как null — и затёр бы baseline.
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const snapItems: SnapshotItem[] = [];
    for (const item of fetched) {
      const direction = classifyItem(item, categories);
      if (direction) {
        result.relevant += 1;
        snapItems.push({ sourceItemId: item.sourceItemId, direction, title: item.title, brand: item.vendor ?? source.name, images: item.images, badges: item.badges });
      }
      const row = {
        source_id: source.source_id, source_item_id: item.sourceItemId, handle: item.handle, title: item.title, product_type: item.productType, direction, published_at: item.publishedAt, last_seen_at: now,
        // Расцветка — отдельный товар у Shopify: ключ склеивает её с моделью.
        model_key: modelKey({ sourceId: source.source_id, sourceItemId: item.sourceItemId, title: item.title }),
        // Каталог брендов — только у наших разделов: ссылки на фото, бренд, метки.
        ...(direction ? catalogFields({ images: item.images, brand: item.vendor ?? source.name, badges: item.badges, badgesKnown: true }) : {}),
      };
      if (plan.baseline || late.has(item.sourceItemId)) inserts.push({ ...row, baseline: true });
      else if (fresh.has(item.sourceItemId)) inserts.push({ ...row, baseline: false });
      else updates.push(row);
    }
    await upsertSourceItems(db, inserts, { fresh: true });
    await upsertSourceItems(db, updates);
    if (!plan.baseline) {
      const { data: queue, error } = await db.from("assortment_source_items")
        .select("source_item_id,handle,direction")
        .eq("source_id", source.source_id).eq("baseline", false).is("reference_id", null).not("direction", "is", null)
        .order("first_seen_at", { ascending: true })
        .limit(50);
      if (error) throw new Error(error.message);
      for (const item of queue ?? []) {
        if (result.added >= NEW_PER_SOURCE || Date.now() > deadline) break;
        try {
          const imported = await importReference(db, { direction: item.direction as AssortmentDirection, url: productUrl(seed, String(item.handle)), via: "crawl" }, "crawler");
          await db.from("assortment_source_items").update({ reference_id: imported.referenceId }).eq("source_id", source.source_id).eq("source_item_id", item.source_item_id);
          if (imported.created) result.added += 1;
        } catch {
          // Одна карточка не прочиталась — остальные идут дальше; эта останется в очереди.
        }
      }
      result.queued = Math.max(0, (queue ?? []).length - result.added);
    }
    // Слой наблюдений: журнал прогона + снимок присутствия раздела (куртки и
    // сумки одним обходом — раздел несёт каждый снимок).
    await recordObservation(db, {
      sourceId: source.source_id, direction: null, coverage,
      seen: result.relevant, added: result.added, startedAt: now,
    }, snapItems);
    result.ok = true;
    await markSource(db, source.source_id, true, null);
  } catch (error) {
    if (error instanceof CrawlTableMissingError) throw error;
    result.error = error instanceof SafeFetchError && error.status ? `HTTP ${error.status}` : error instanceof Error ? error.message.slice(0, 200) : "ошибка";
    await markSource(db, source.source_id, false, result.error);
  }
  return result;
}

/** Обойти все проверенные Shopify-источники. Отказ одного не останавливает остальные. */
export async function runCatalogCrawl(db: SupabaseClient, deadline: number, only?: string | null): Promise<SourceCrawlResult[]> {
  const { data, error } = await db.from("assortment_sources").select("source_id,name,categories,access_status,access_note,seed_urls");
  if (error) throw new Error(error.message);
  const sources = ((data ?? []) as SourceRow[]).filter((s) => isShopifyCrawlable(s) && (!only || s.source_id === only));
  const results: SourceCrawlResult[] = [];
  for (const source of sources) {
    if (Date.now() > deadline) break;
    results.push(await crawlSource(db, source, deadline));
  }
  return results;
}
