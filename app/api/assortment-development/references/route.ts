import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { ASSORTMENT_ROLES, parseDirection } from "@/lib/assortment/constants";
import { isMissingAssortmentSchema, MIGRATION_HINT } from "@/lib/assortment/errors";
import { loadFeed, type FeedView } from "@/lib/assortment/feed";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** Лента раздела: карточки моделей с обложкой и объяснением «почему показали». */
export async function GET(request: NextRequest) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  const direction = parseDirection(request.nextUrl.searchParams.get("direction"));
  if (!direction) return NextResponse.json({ error: "direction должен быть jackets или bags" }, { status: 400 });
  const requested = request.nextUrl.searchParams.get("view");
  const view: FeedView = requested === "retail" || requested === "hidden" || requested === "ru" ? requested : "new";
  try {
    return NextResponse.json({ cards: await loadFeed(db, direction, view) });
  } catch (error) {
    if (isMissingAssortmentSchema(error)) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Лента не загрузилась" }, { status: 500 });
  }
}
