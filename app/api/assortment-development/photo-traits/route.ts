import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { loadPhotoTraits } from "@/lib/assortment/catalogAiStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

class NoReport extends Error {}

/**
 * Признаки каталога по фото (оценка ИИ): доли значений по признакам среди моделей,
 * где признак виден. report: null — таблицы ещё нет или ничего не разобрано.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const direction = parseDirection(request.nextUrl.searchParams.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  try {
    // Разбор идёт сотнями в сутки, а отчёт тянет весь каталог и признаки (~7 запросов) — на час в кэше.
    // Пустой результат (нет таблицы, ничего не разобрано) в кэш не кладём.
    const report = await loadHourlyDashboard("assortment-photo-traits", { direction }, async () => {
      const result = await loadPhotoTraits(db, direction);
      if (!result) throw new NoReport();
      return result;
    }).catch((error) => {
      if (error instanceof NoReport) return null;
      throw error;
    });
    return NextResponse.json({ report }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Признаки по фото не посчитались" }, { status: 500 });
  }
}
