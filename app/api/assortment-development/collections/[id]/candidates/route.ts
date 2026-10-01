import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { collectionFailure, isUuid } from "@/lib/assortment/collectionsApi";
import { loadCandidates } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** Кандидаты в подборку: сильные сигналы выше, расцветки уже взятых моделей — ниже. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Подборка не найдена" }, { status: 404 });
  try {
    return NextResponse.json({ candidates: await loadCandidates(db, id) });
  } catch (error) {
    return collectionFailure(error);
  }
}
