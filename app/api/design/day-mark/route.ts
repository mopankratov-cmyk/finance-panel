import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = await request.json().catch(() => ({}));
  if (!b.nm || !b.type) return NextResponse.json({ error: "Нужны nm и type" }, { status: 400 });
  const { error } = await db.from("card_changes").insert({ nm_id: b.nm, article: b.art ?? null, change_type: b.type, note: b.note ?? null, date: b.date ?? new Date().toISOString().slice(0, 10) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
