import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export interface SyncLogRow {
  id: number;
  job: string;
  status: string;
  rows_affected: number | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ data: null, error: "Supabase не настроен" }, { status: 500 });
  }

  const { data, error } = await db
    .from("sync_log")
    .select("id, job, status, rows_affected, error, started_at, finished_at")
    .order("finished_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ data: null, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data as SyncLogRow[], error: null });
}
