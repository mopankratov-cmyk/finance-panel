import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
export const dynamic = "force-dynamic";
// Отметки на днях (изменения по датам).
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ marks: {} });
  const { data } = await db.from("card_changes").select("nm_id, date, change_type").limit(500);
  const marks: Record<string, { type: string }[]> = {};
  for (const r of data ?? []) {
    const key = `${r.nm_id}|${String(r.date).slice(0, 10)}`;
    (marks[key] = marks[key] || []).push({ type: r.change_type });
  }
  return NextResponse.json({ marks });
}
