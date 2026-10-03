import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { checkAssortmentCollectorAuth } from "@/lib/assortment/collectorAuth";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { miniShopsPlan, parseMiniShopPages, RuShopPagesError } from "@/lib/assortment/ruShops";
import { crawlShop } from "@/lib/assortment/ruShopsStore";
import { ASSORTMENT_BOT_UA } from "@/lib/assortment/safeFetch";
import { writeSyncLog } from "@/lib/sync/helpers";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const JOB = "assortment-ru-shops";
const BUDGET_MS = 100_000;
/** Посылка сжата: несколько страниц каталога по ~0,5–1 МБ сжимаются раз в десять. */
const MAX_PACKED_BYTES = 4_000_000;
const MAX_UNPACKED_BYTES = 60_000_000;

/**
 * Загрузчик каталогов российских брендов на Mac mini (сайты, которые не пускают
 * облако). GET — план на сегодня: какие страницы скачать и как понять, что
 * страница пустая; `?all=1` или `?source=S131` — вне дней магазина. POST —
 * сжатая посылка страниц одного магазина; разбор, база и новинки — в панели.
 * Пульс — строка sync_log «assortment-ru-shops» на каждую посылку.
 */
export async function GET(request: NextRequest) {
  const authError = checkAssortmentCollectorAuth(request);
  if (authError) return authError;
  const params = request.nextUrl.searchParams;
  return NextResponse.json({
    userAgent: ASSORTMENT_BOT_UA,
    shops: miniShopsPlan(new Date(), { all: params.get("all") === "1", only: params.get("source") }),
  });
}

export async function POST(request: NextRequest) {
  const authError = checkAssortmentCollectorAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  let parcel;
  try {
    const packed = Buffer.from(await request.arrayBuffer());
    if (packed.length > MAX_PACKED_BYTES) throw new RuShopPagesError("Посылка больше 4 МБ — делите по разделам");
    const raw = gunzipSync(packed, { maxOutputLength: MAX_UNPACKED_BYTES }).toString("utf8");
    parcel = parseMiniShopPages(JSON.parse(raw));
  } catch (error) {
    return NextResponse.json({ error: error instanceof RuShopPagesError ? error.message : "Неверная посылка" }, { status: 400 });
  }

  try {
    const { shop, pages } = parcel;
    const result = await crawlShop(db, shop, startedAt.getTime() + BUDGET_MS, async (slug, page) => pages.get(slug)?.[page - 1] ?? null);
    await writeSyncLog(JOB, result.ok ? (result.error ? "partial" : "ok") : "error", result.added, result.error ? `${shop.name}: ${result.error}` : null, startedAt);
    return NextResponse.json({ ok: result.ok, result });
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ ok: true, skipped: "таблицы модуля не созданы" });
    const message = error instanceof Error ? error.message : "Приём не удался";
    await writeSyncLog(JOB, "error", null, message, startedAt);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
