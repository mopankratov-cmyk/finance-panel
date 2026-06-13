import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Эффект правок контента по одному nm (после добавления заметки). Из card_changes.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ nm: string }> }) {
  const { nm } = await ctx.params;
  const nmId = Number(nm);
  const db = getSupabaseAdmin();
  if (!db || !nmId) return NextResponse.json({ nm: nmId, items: [] });
  const { data } = await db
    .from("card_changes")
    .select("id, nm_id, article, change_type, note, date")
    .eq("nm_id", nmId)
    .order("date", { ascending: false });
  const items = (data ?? []).map((r) => ({ id: r.id, nm: r.nm_id, art: r.article, type: r.change_type, note: r.note, date: String(r.date).slice(0, 10) }));
  return NextResponse.json({ nm: nmId, items });
}
