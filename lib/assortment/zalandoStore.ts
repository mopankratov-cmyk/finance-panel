import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestRecords } from "./brightdataCrawl";
import { parseZalandoCatalog, zalandoTargetByUrl, ZALANDO_SOURCES, ZALANDO_TARGETS } from "./zalando";

/**
 * Обход страниц Zalando (Bershka, Pull&Bear, Massimo Dutti). Zalando —
 * зарубежный сайт, ходим из облака честным заголовком робота; пауза между
 * страницами. Разбор, база и новинки — общим приёмом записей (как у других
 * источников): каждая страница отсортирована по новизне, первый обход — база.
 */


export interface ZalandoResult {
  sourceId: string;
  name: string;
  ok: boolean;
  collected: number;
  added: number;
  baseline: boolean;
  error: string | null;
}


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
 * Разбор присланных загрузчиком страниц Zalando и запись: ensureSources,
 * разбор по адресу, общий приём записей (первый обход — база). Облако Vercel
 * Zalando не пускает (AWS), поэтому страницы приносит загрузчик на mini.
 */
export async function ingestZalandoPages(
  db: SupabaseClient,
  parcel: { sourceId: string; pages: Array<{ url: string; html: string }> },
  deadline: number,
): Promise<ZalandoResult> {
  await ensureSources(db);
  const source = ZALANDO_SOURCES.find((s) => s.sourceId === parcel.sourceId)!;
  const result: ZalandoResult = { sourceId: source.sourceId, name: source.name, ok: false, collected: 0, added: 0, baseline: false, error: null };
  const now = new Date().toISOString();
  const warnings: string[] = [];
  try {
    for (const page of parcel.pages) {
      if (Date.now() > deadline) break;
      const target = zalandoTargetByUrl(page.url);
      if (!target || target.sourceId !== source.sourceId) {
        warnings.push("лишняя страница в посылке пропущена");
        continue;
      }
      const records = parseZalandoCatalog(page.html, target);
      if (records.length === 0) {
        warnings.push(`${target.direction}: страница без товаров — разметка Zalando могла поменяться`);
        continue;
      }
      const done = await ingestRecords(db, { sourceId: source.sourceId, name: source.name }, { direction: target.direction, method: "crawl_zalando" }, records, deadline, { churnGuard: true, coverage: "window" });
      result.collected += done.collected;
      result.added += done.added;
      result.baseline = result.baseline || done.baseline;
      if (done.churn) warnings.push(`${target.direction}: слишком много новых разом — похоже на пересортировку, обход лёг базой`);
    }
    result.ok = true;
    result.error = warnings.length ? warnings.join("; ") : null;
    await mark(db, source.sourceId, { last_attempt_at: now, last_error: result.error, ...(result.collected > 0 ? { last_success_at: now } : {}) });
  } catch (error) {
    result.error = error instanceof Error ? error.message.slice(0, 200) : "разбор не удался";
    await mark(db, source.sourceId, { last_attempt_at: now, last_error: result.error });
  }
  return result;
}
// Загрузка страниц Zalando — на загрузчике mini (облако Vercel Zalando не пускает).

