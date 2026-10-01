import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { isMissingAssortmentSchema, MIGRATION_HINT } from "@/lib/assortment/errors";
import { isModelId, loadCompare } from "@/lib/assortment/model";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** Сравнение 2–6 моделей одного раздела: фото рядом, общее и различия. */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const direction = parseDirection(request.nextUrl.searchParams.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  const ids = [...new Set((request.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(isModelId))];
  if (ids.length < 2 || ids.length > 6) return NextResponse.json({ error: "Для сравнения выберите от 2 до 6 моделей" }, { status: 400 });
  try {
    return NextResponse.json(await loadCompare(db, direction, ids));
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Сравнение не загрузилось" }, { status: 500 });
  }
}
