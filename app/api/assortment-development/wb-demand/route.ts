import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { DemandUnavailableError, loadWbDemand } from "@/lib/assortment/wbDemandStore";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Спрос на WB по слову модели: частотность запросов из недельных срезов в базе
 * (сборщик /api/sync/assortment-wb-queries), без цен и выручки. MPSTATS здесь не зовём.
 */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const direction = parseDirection(request.nextUrl.searchParams.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  const term = (request.nextUrl.searchParams.get("term") ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (term.length < 3 || term.length > 60) return NextResponse.json({ error: "Слово для поиска — от 3 до 60 знаков" }, { status: 400 });
  try {
    return NextResponse.json({ demand: await loadWbDemand(db, direction, term) });
  } catch (error) {
    if (error instanceof DemandUnavailableError) return NextResponse.json({ error: error.message, unavailable: true }, { status: 200 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Спрос не посчитался" }, { status: 500 });
  }
}
