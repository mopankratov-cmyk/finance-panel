import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Список CTR-A/B-тестов. Хранятся в ctr_tests (если таблица есть); истинный per-variant замер отложен (docs/отложено.md).
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ tests: [] });
  const { data, error } = await db.from("ctr_tests").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ tests: [] });
  return NextResponse.json({ tests: data ?? [] });
}
