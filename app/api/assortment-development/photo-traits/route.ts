import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { loadPhotoSamples } from "@/lib/assortment/catalogAiStore";
import { loadPhotoTraitsCached } from "@/lib/assortment/photoTraitsCached";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Признаки каталога по фото (оценка ИИ): доли значений по признакам среди моделей,
 * где признак виден. report: null — таблицы ещё нет или ничего не разобрано.
 * `?samples=1&seed=…&limit=12` — вместо долей примеры разбора (фото, название и то, что
 * написал ИИ): сверить описание с картинкой; без кэша, зерно меняет выборку.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const direction = parseDirection(request.nextUrl.searchParams.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  if (request.nextUrl.searchParams.get("samples") === "1") {
    try {
      const seed = (request.nextUrl.searchParams.get("seed") ?? "").slice(0, 40);
      const limit = Number(request.nextUrl.searchParams.get("limit")) || 12;
      return NextResponse.json({ result: await loadPhotoSamples(db, direction, { seed, limit }) }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Примеры не загрузились" }, { status: 500 });
    }
  }
  try {
    // Разбор идёт сотнями в сутки, а отчёт тянет весь каталог и признаки (~7 запросов) — на час в кэше (один с полоской «На чём стоят цифры»).
    const report = await loadPhotoTraitsCached(db, direction);
    return NextResponse.json({ report }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Признаки по фото не посчитались" }, { status: 500 });
  }
}
