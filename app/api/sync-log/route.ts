import { NextResponse } from "next/server";
import { syncLogErrorText } from "@/lib/assortment/catalogAi";
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
  // Служебная метка причины остановки разбора по фото (`[stop:…]`) нужна полоске модуля, а не человеку в журнале.
  const rows = ((data ?? []) as SyncLogRow[]).map((row) => ({ ...row, error: syncLogErrorText(row.job, row.error) }));
  return NextResponse.json({ data: rows, error: null });
}
