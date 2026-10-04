import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { checkAssortmentCollectorAuth } from "@/lib/assortment/collectorAuth";
import { isMissingAssortmentSchema } from "@/lib/assortment/errors";
import { miniShopsPlan, parseMiniShopPages, RuShopPagesError } from "@/lib/assortment/ruShops";
import { zalandoMiniPlan, ZALANDO_SOURCES } from "@/lib/assortment/zalando";
import { ingestZalandoPages } from "@/lib/assortment/zalandoStore";
import { attachMiniPhoto, crawlShop, MiniPhotoError } from "@/lib/assortment/ruShopsStore";
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
 * Загрузчик каталогов на Mac mini: российские бренды и Zalando (его облако
 * Vercel не пускает). `?zalando=1` — посылка страниц Zalando.
 *
 * Загрузчик каталогов российских брендов на Mac mini (сайты, которые не пускают
 * облако). GET — план на сегодня: какие страницы скачать и как понять, что
 * страница пустая; `?all=1` или `?source=S131` — вне дней магазина. POST —
 * сжатая посылка страниц одного магазина; разбор, база и новинки — в панели.
 * В ответе — новые находки, чьи фото панель скачать не смогла (CDN тоже не
 * пускает облако): загрузчик приносит их `POST ?photo=1` { referenceId, url,
 * data: base64 } — только для свежей находки своего магазина и с его CDN.
 * Пульс — строка sync_log «assortment-ru-shops» на каждую посылку.
 */
export async function GET(request: NextRequest) {
  const authError = checkAssortmentCollectorAuth(request);
  if (authError) return authError;
  const params = request.nextUrl.searchParams;
  return NextResponse.json({
    userAgent: ASSORTMENT_BOT_UA,
    shops: miniShopsPlan(new Date(), { all: params.get("all") === "1", only: params.get("source") }),
    // Zalando блокирует облако Vercel — его страницы тоже приносит загрузчик.
    zalando: zalandoMiniPlan(new Date(), { all: params.get("all") === "1", only: params.get("source") }),
  });
}

export async function POST(request: NextRequest) {
  const authError = checkAssortmentCollectorAuth(request);
  if (authError) return authError;
  const startedAt = new Date();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  if (request.nextUrl.searchParams.get("photo") === "1") {
    const body = (await request.json().catch(() => null)) as { referenceId?: unknown; url?: unknown; data?: unknown } | null;
    try {
      const bytes = typeof body?.data === "string" ? Buffer.from(body.data, "base64") : Buffer.alloc(0);
      const stored = await attachMiniPhoto(db, { referenceId: body?.referenceId, url: body?.url, bytes });
      return NextResponse.json({ ok: true, stored });
    } catch (error) {
      if (error instanceof MiniPhotoError) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ error: error instanceof Error ? error.message : "Фото не сохранилось" }, { status: 500 });
    }
  }

  if (request.nextUrl.searchParams.get("zalando") === "1") {
    let data: { sourceId?: unknown; pages?: unknown };
    try {
      const packed = Buffer.from(await request.arrayBuffer());
      if (packed.length > MAX_PACKED_BYTES) throw new RuShopPagesError("Посылка больше 4 МБ");
      data = JSON.parse(gunzipSync(packed, { maxOutputLength: MAX_UNPACKED_BYTES }).toString("utf8"));
    } catch (error) {
      return NextResponse.json({ error: error instanceof RuShopPagesError ? error.message : "Неверная посылка" }, { status: 400 });
    }
    const sourceId = typeof data.sourceId === "string" ? data.sourceId : "";
    const pages = Array.isArray(data.pages) ? data.pages.filter((p): p is { url: string; html: string } => Boolean(p) && typeof p.url === "string" && typeof p.html === "string" && p.html.length <= 4_000_000) : [];
    if (!ZALANDO_SOURCES.some((s) => s.sourceId === sourceId) || pages.length === 0 || pages.length > 4) {
      return NextResponse.json({ error: "Неверная посылка Zalando" }, { status: 400 });
    }
    try {
      const result = await ingestZalandoPages(db, { sourceId, pages }, startedAt.getTime() + BUDGET_MS);
      await writeSyncLog(JOB, result.ok ? (result.error ? "partial" : "ok") : "error", result.added, result.error ? `${result.name}: ${result.error}` : null, startedAt);
      return NextResponse.json({ ok: result.ok, result });
    } catch (error) {
      if (isMissingAssortmentSchema(error)) return NextResponse.json({ ok: true, skipped: "таблицы модуля не созданы" });
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Приём не удался" }, { status: 502 });
    }
  }

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
