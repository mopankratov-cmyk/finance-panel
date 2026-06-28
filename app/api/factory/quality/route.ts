import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadFactoryQualityStats } from "@/lib/factory/qualityStats";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const sp = req.nextUrl.searchParams;
    const hours = Math.max(1, Math.min(24 * 30, Number(sp.get("hours")) || 24));
    const niche = (sp.get("niche") || "").trim() || null;
    const quality = await loadFactoryQualityStats(db, { hours, niche });
    return NextResponse.json({
      ok: true,
      headline_metric: "frames_grounded_otk_pass_rate",
      denominator: "produced_videos",
      quality,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      headline_metric: "frames_grounded_otk_pass_rate",
      denominator: "produced_videos",
      quality: null,
      error: "quality route crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
