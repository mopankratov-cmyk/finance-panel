import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// GET /api/repricer/decisions?date=&cabinet= — решения прогона.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ decisions: [] });

  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const cabinet = url.searchParams.get("cabinet");

  let q = db.from("repricer_decisions").select("*").order("created_at", { ascending: false });
  if (date) q = q.eq("run_date", date);
  if (cabinet != null) q = q.eq("cabinet", cabinet);
  const { data, error } = await q.limit(2000);
  if (error) return NextResponse.json({ decisions: [], error: error.message });
  return NextResponse.json({ count: (data ?? []).length, decisions: data ?? [] });
}
