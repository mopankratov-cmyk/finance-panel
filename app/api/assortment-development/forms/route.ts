import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { isMissingAssortmentSchema, MIGRATION_HINT } from "@/lib/assortment/errors";
import { loadFormsReport } from "@/lib/assortment/formsStore";
import { loadFormDemand } from "@/lib/assortment/wbDemandStore";
import { loadProfiles } from "@/lib/assortment/brandProfilesStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Формы моделей каталога по названиям: сколько моделей каждой формы, у скольких
 * источников, насколько форма сосредоточена в одном. Срез на сегодня — не
 * динамика: история наблюдений только начинает копиться. К срезу добавлен спрос на
 * WB по формам (недельные срезы из базы; null, пока сборщик ничего не снял) и
 * решения профилей брендов по формам (только где владелец что-то решил).
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const direction = parseDirection(request.nextUrl.searchParams.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  try {
    const [report, demand, profiles] = await Promise.all([
      loadFormsReport(db, direction),
      loadFormDemand(db, direction),
      // Профили — подсказка к формам: сбой чтения вкладку не роняет.
      loadProfiles(db).then((r) => r.profiles.filter((p) => p.direction === direction && p.fitForms.length + p.avoidForms.length > 0)).catch(() => []),
    ]);
    return NextResponse.json({ report, demand, profiles }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Формы не посчитались" }, { status: 500 });
  }
}
