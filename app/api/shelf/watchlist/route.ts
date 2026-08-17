import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { checkCronAuth } from "@/lib/sync/helpers";

export const dynamic = "force-dynamic";

// Список артикулов для внешнего сборщика «Полок» (tools/shelf-collector).
// Авторизация — тот же CRON_SECRET, что и у синков: сборщик работает на машине
// владельца без сессии. Отдаём только номера артикулов — сборщику больше не нужно.
export async function GET(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 503 });

  const { data, error } = await db
    .from("wb_shelf_watch")
    .select("nm_id")
    .eq("active", true)
    .order("nm_id", { ascending: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });

  const articles = [...new Set((data ?? []).map((row) => Number(row.nm_id)).filter((nm) => Number.isFinite(nm)))];
  return NextResponse.json({ ok: true, articles });
}
