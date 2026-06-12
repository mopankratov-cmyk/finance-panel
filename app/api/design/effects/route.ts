import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
export const dynamic = "force-dynamic";
// Эффекты изменений карточек (из card_changes).
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ effects: [] });
  const { data } = await db.from("card_changes").select("id, nm_id, article, change_type, note, date").order("date", { ascending: false }).limit(200);
  const effects = (data ?? []).map((r) => ({ id: r.id, nm: r.nm_id, art: r.article, type: r.change_type, note: r.note, date: String(r.date).slice(0, 10) }));
  return NextResponse.json({ effects });
}
