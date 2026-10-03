import { NextRequest, NextResponse } from "next/server";
import { CrawlTableMissingError, runCatalogCrawl } from "@/lib/assortment/crawlStore";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { RU_SHOPS } from "@/lib/assortment/ruShops";
import { runRuShopsCrawl } from "@/lib/assortment/ruShopsStore";
import { checkCronAuth, writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB = "assortment-crawl";
const BUDGET_MS = 240_000;
/** Сайты российских брендов идут первыми и не дольше этого — остальное время Shopify. */
const RU_SHOPS_BUDGET_MS = 110_000;

/**
 * Ежедневный автообход каталогов Shopify-брендов модуля «Разработка
 * ассортимента» (06:30 МСК, крон `30 3 * * *`). Первый обход источника — база
 * сравнения, в ленту ничего не пишет; дальше новые товары сумок и курток
 * попадают в ленту, по 8 на источник за прогон (остальное — очередь).
 * Отказ одного источника не останавливает остальные; пульс каждого — в
 * assortment_sources.last_attempt_at / last_error.
 *
 * По понедельникам и четвергам первым идёт Lime (limestore.com): новинки по
 * карте сайта, название и фото — из каталога.
 *
 * `?source=S024` — обойти один источник (ручной запуск, в любой день).
 */
export async function GET(request: NextRequest) {
  const authError = await checkCronAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });
  const only = request.nextUrl.searchParams.get("source");
  try {
    const ruOnly = only ? RU_SHOPS.some((s) => s.sourceId === only) : null;
    const ruShops = ruOnly === false ? [] : await runRuShopsCrawl(db, startedAt.getTime() + RU_SHOPS_BUDGET_MS, only);
    const shopify = ruOnly ? [] : await runCatalogCrawl(db, startedAt.getTime() + BUDGET_MS, only);
    const results = [...ruShops, ...shopify];
    const failed = results.filter((r) => !r.ok);
    const added = results.reduce((s, r) => s + r.added, 0);
    const status = failed.length === 0 ? "ok" : failed.length < results.length ? "partial" : "error";
    await writeSyncLog(JOB, status, added, failed.length ? failed.map((r) => `${r.name}: ${r.error}`).join("; ") : null, startedAt);
    return NextResponse.json({ ok: status !== "error", results });
  } catch (error) {
    if (error instanceof CrawlTableMissingError || isMissingAssortmentSchema(error)) {
      return NextResponse.json({ ok: true, skipped: error instanceof Error ? error.message : "миграция не применена" });
    }
    const message = error instanceof Error ? error.message : "Обход не удался";
    await writeSyncLog(JOB, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
