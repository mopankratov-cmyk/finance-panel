import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { loadAccuracy, loadVerdicts } from "@/lib/assortment/attributeVerdictsStore";
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
  // Точность разбора, измеренная человеком (отметки «верно/неверно»): меняется с каждой отметкой — без кэша. accuracy: null — таблицы
  // отметок нет (миграция не применена); сбой чтения — ошибка 500, а не тот же null: «нет отметок» и «не прочитали» экран показывает по-разному.
  if (request.nextUrl.searchParams.get("accuracy") === "1") {
    try {
      return NextResponse.json({ accuracy: await loadAccuracy(db, direction) }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Точность не посчиталась" }, { status: 500 });
    }
  }
  if (request.nextUrl.searchParams.get("samples") === "1") {
    try {
      const seed = (request.nextUrl.searchParams.get("seed") ?? "").slice(0, 40);
      const limit = Number(request.nextUrl.searchParams.get("limit")) || 12;
      const onlyUnjudged = request.nextUrl.searchParams.get("unjudged") === "1";
      // Простые примеры сбой чтения отметок не роняет — они и без отметок целы. А разметка без отметок невозможна: не знаем, что уже
      // размечено, и «таблицы нет» (null) от «не прочитали» (ошибка) надо различать — экран про миграцию говорит только в первом случае.
      let verdicts: Awaited<ReturnType<typeof loadVerdicts>> | undefined;
      try {
        verdicts = await loadVerdicts(db, direction);
      } catch (error) {
        if (onlyUnjudged) return NextResponse.json({ error: `Отметки не загрузились (${error instanceof Error ? error.message : "сбой чтения"}) — попробуйте ещё раз` }, { status: 500 });
      }
      return NextResponse.json({ result: await loadPhotoSamples(db, direction, { seed, limit, verdicts, onlyUnjudged }) }, { headers: { "Cache-Control": "private, no-store" } });
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
