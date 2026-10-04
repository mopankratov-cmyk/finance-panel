import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestRecords } from "./brightdataCrawl";
import { ASSORTMENT_BOT_UA, safeFetch } from "./safeFetch";
import { parseZalandoCatalog, ZALANDO_SOURCES, ZALANDO_TARGETS } from "./zalando";

/**
 * Обход страниц Zalando (Bershka, Pull&Bear, Massimo Dutti). Zalando —
 * зарубежный сайт, ходим из облака честным заголовком робота; пауза между
 * страницами. Разбор, база и новинки — общим приёмом записей (как у других
 * источников): каждая страница отсортирована по новизне, первый обход — база.
 */

const PAGE_PAUSE_MS = 2_000;
const PAGE_MAX_BYTES = 4_000_000;
const WEEKDAYS_UTC = [1, 4]; // пн и чт

export interface ZalandoResult {
  sourceId: string;
  name: string;
  ok: boolean;
  collected: number;
  added: number;
  baseline: boolean;
  error: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureSources(db: SupabaseClient) {
  const rows = ZALANDO_SOURCES.map((s) => ({
    source_id: s.sourceId,
    name: s.name,
    source_group: "Зарубежные бренды",
    categories: ["jackets", "bags"],
    region: "Zalando (Германия)",
    priority: "P1",
    adapter_type: "Каталог Zalando",
    access_status: "auto_verified",
    access_note: `Новинки ${s.brand} со страниц Zalando (сайт бренда закрыт проверкой на бота); robots.txt Zalando разрешает; сортировка по новизне; цены не читаем`,
    research_status: "Зарубежные бренды",
    seed_urls: ["https://www.zalando.de/"],
  }));
  const { error } = await db.from("assortment_sources").upsert(rows, { onConflict: "source_id" });
  if (error) throw new Error(error.message);
}

async function mark(db: SupabaseClient, sourceId: string, patch: Record<string, unknown>) {
  await db.from("assortment_sources").update(patch).eq("source_id", sourceId).then(() => undefined);
}

/**
 * Обход Zalando. Плановый — только в дни источника; `only` (ручной запуск
 * одного источника) — в любой день.
 */
export async function runZalandoCrawl(db: SupabaseClient, deadline: number, only?: string | null): Promise<ZalandoResult[]> {
  const today = new Date().getUTCDay();
  if (!only && !WEEKDAYS_UTC.includes(today)) return [];
  await ensureSources(db);
  const results: ZalandoResult[] = [];
  let first = true;
  for (const source of ZALANDO_SOURCES) {
    if (only && source.sourceId !== only) continue;
    if (Date.now() > deadline) break;
    const now = new Date().toISOString();
    const result: ZalandoResult = { sourceId: source.sourceId, name: source.name, ok: false, collected: 0, added: 0, baseline: false, error: null };
    const warnings: string[] = [];
    try {
      for (const target of ZALANDO_TARGETS.filter((t) => t.sourceId === source.sourceId)) {
        if (Date.now() > deadline) break;
        if (!first) await sleep(PAGE_PAUSE_MS);
        first = false;
        const response = await safeFetch(target.url, { maxBytes: PAGE_MAX_BYTES, timeoutMs: 30_000, accept: "text/html", userAgent: ASSORTMENT_BOT_UA });
        const records = parseZalandoCatalog(response.body.toString("utf8"), target);
        if (records.length === 0) {
          warnings.push(`${target.direction}: страница без товаров — разметка Zalando могла поменяться`);
          continue;
        }
        const done = await ingestRecords(db, { sourceId: source.sourceId, name: source.name }, { direction: target.direction, method: "crawl_zalando" }, records, deadline, { churnGuard: true });
        result.collected += done.collected;
        result.added += done.added;
        result.baseline = result.baseline || done.baseline;
        if (done.churn) warnings.push(`${target.direction}: слишком много новых разом — похоже на пересортировку, обход лёг базой`);
      }
      result.ok = true;
      result.error = warnings.length ? warnings.join("; ") : null;
      await mark(db, source.sourceId, { last_attempt_at: now, last_error: result.error, ...(result.collected > 0 ? { last_success_at: now } : {}) });
    } catch (error) {
      result.error = error instanceof Error ? error.message.slice(0, 200) : "обход не удался";
      await mark(db, source.sourceId, { last_attempt_at: now, last_error: result.error });
    }
    results.push(result);
  }
  return results;
}
