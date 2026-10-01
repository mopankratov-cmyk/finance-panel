import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { collectionFailure, isUuid } from "@/lib/assortment/collectionsApi";
import { suggestDraft } from "@/lib/assortment/collectionsStore";
import { ASSORTMENT_ROLES } from "@/lib/assortment/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * Предложение черновика плана сумок: разные конструкции, сильные сигналы,
 * похожее на отклонённое — в последнюю очередь. Ничего не записывает.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSession(ASSORTMENT_ROLES);
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Подборка не найдена" }, { status: 404 });
  try {
    return NextResponse.json({ draft: await suggestDraft(db, id) });
  } catch (error) {
    return collectionFailure(error);
  }
}
