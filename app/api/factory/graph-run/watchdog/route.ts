import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wakeStaleRecipes } from "@/lib/factory/graphWatchdog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Явный watchdog для графа: та же логика, что и у cron-страховки, но как отдельная точка самопочинки.
// Можно дергать вручную из Studio/ops, если нужно сразу будить зависший граф, не дожидаясь след. тика.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const result = await wakeStaleRecipes(db, req.nextUrl.origin, { trigger: "watchdog" });
  return NextResponse.json({ ok: true, ...result, mode: "watchdog" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
