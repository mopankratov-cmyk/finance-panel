import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildViewingIntelligenceReport, type ReelsViewingSourceRow } from "@/lib/factory/reelsBrainViewingIntelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function parseList(value: string | null, fallback: string): string[] {
  return Array.from(new Set(String(value || fallback)
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)))
    .slice(0, 12);
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) {
      return NextResponse.json({
        warning: "Supabase не настроен",
        ...buildViewingIntelligenceReport([]),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const sp = req.nextUrl.searchParams;
    const niches = parseList(sp.get("niches") || sp.get("niche"), "ru_toys,ru_clothing,ru_cosmetics");
    const platforms = parseList(sp.get("platforms") || sp.get("platform"), "tiktok,instagram,youtube");
    const limitPerNiche = Math.min(2000, Math.max(20, Number(sp.get("limit_per_niche") || 500)));
    const rows: ReelsViewingSourceRow[] = [];
    const warnings: string[] = [];

    for (const niche of niches) {
      let query = db
        .from("viral_videos")
        .select("id,url,platform,niche,caption,hook_text,format_detected,sound_title,source_orbit_id,views,likes,followers_creator,virality_score,created_at,analyzed,analyzed_full")
        .eq("niche", niche)
        .order("virality_score", { ascending: false, nullsFirst: false })
        .limit(limitPerNiche);
      if (platforms.length) query = query.in("platform", platforms);
      const { data, error } = await query;
      if (error) {
        warnings.push(`${niche}: ${error.message}`);
        continue;
      }
      rows.push(...((data || []) as ReelsViewingSourceRow[]));
    }

    return NextResponse.json({
      ...buildViewingIntelligenceReport(rows),
      niches,
      platforms,
      limit_per_niche: limitPerNiche,
      warnings,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "viewing-intelligence reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
