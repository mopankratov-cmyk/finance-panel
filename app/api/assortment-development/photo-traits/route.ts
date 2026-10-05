import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { TRAITS_REPORT_VERSION } from "@/lib/assortment/catalogAi";
import { loadPhotoSamples, loadPhotoTraits } from "@/lib/assortment/catalogAiStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

class NoReport extends Error {}
/** Пока разбор идёт сотнями в час, отчёт в кэше на час был бы заметно устаревшим: до этого числа моделей его не кэшируем. */
const CACHE_FROM_ANALYZED = 300;
class Uncached extends Error {
  constructor(readonly report: unknown) {
    super("uncached");
  }
}

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
    // Разбор идёт сотнями в сутки, а отчёт тянет весь каталог и признаки (~7 запросов) — на час в кэше.
    // Пустой результат (нет таблицы, ничего не разобрано) в кэш не кладём.
    const report = await loadHourlyDashboard(`assortment-photo-traits-v${TRAITS_REPORT_VERSION}`, { direction }, async () => {
      const result = await loadPhotoTraits(db, direction);
      if (!result) throw new NoReport();
      if (result.analyzed < CACHE_FROM_ANALYZED) throw new Uncached(result);
      return result;
    }).catch((error) => {
      if (error instanceof NoReport) return null;
      if (error instanceof Uncached) return error.report;
      throw error;
    });
    return NextResponse.json({ report }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Признаки по фото не посчитались" }, { status: 500 });
  }
}
