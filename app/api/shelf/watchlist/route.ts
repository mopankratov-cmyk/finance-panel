import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkShelfCollectorAuth } from "@/lib/shelf/collectorAuth";

export const dynamic = "force-dynamic";

// Список артикулов для внешнего сборщика «Полок» (tools/shelf-collector).
// Сборщик работает на машине владельца без сессии — авторизация секретом
// (SHELF_CRON_SECRET или серверный CRON_SECRET).
// `pending` — артикулы, у которых есть отслеживание без единого снимка:
// сборщик подбирает их на 15-минутных проверках вне плановых слотов, чтобы
// добавленный артикул не ждал следующего слота часами.
export async function GET(request: NextRequest) {
  const denied = checkShelfCollectorAuth(request);
  if (denied) return denied;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });

  const { data, error } = await db
    .from("wb_shelf_watch")
    .select("nm_id, wb_shelf_snapshots(id)")
    .eq("active", true)
    .order("nm_id", { ascending: true })
    .limit(1, { foreignTable: "wb_shelf_snapshots" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });

  const rows = (data ?? []) as { nm_id: number; wb_shelf_snapshots: { id: string }[] | null }[];
  const articles = [...new Set(rows.map((row) => Number(row.nm_id)).filter((nm) => Number.isFinite(nm)))];
  const pending = [...new Set(rows
    .filter((row) => (row.wb_shelf_snapshots ?? []).length === 0)
    .map((row) => Number(row.nm_id))
    .filter((nm) => Number.isFinite(nm)))];
  return NextResponse.json({ ok: true, articles, pending });
}
