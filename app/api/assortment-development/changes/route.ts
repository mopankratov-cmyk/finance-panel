import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { parseChangesPeriod } from "@/lib/assortment/appearance";
import { loadChanges, loadChangesTab } from "@/lib/assortment/appearanceStore";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * «Изменения»: что у брендов появилось и пропало за период — по снимкам полных прогонов обхода, и что впервые попало в верх выдачи
 * у источников, которые видят только его. ?direction=jackets|bags, ?days=7|30 (неделя по умолчанию), ?count=1 — только «есть ли
 * вкладка» (журнал прогонов, без снимков), ?timings=1 — замер. Только чтение базы.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const mark = (name: string) => { timings[name] = Date.now() - startedAt; };
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const params = request.nextUrl.searchParams;
  const direction = parseDirection(params.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  try {
    if (params.get("count") === "1") {
      return NextResponse.json(await loadChangesTab(db, direction), { headers: { "Cache-Control": "private, no-store" } });
    }
    const result = await loadChanges(db, { direction, periodDays: parseChangesPeriod(params.get("days")), mark });
    mark("total");
    // Кнопки «Отобрать» и «Не интересно» меняют карточки — браузеру не кешировать.
    return NextResponse.json(params.get("timings") === "1" ? { ...result, timings } : result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Изменения не посчитались" }, { status: 500 });
  }
}
