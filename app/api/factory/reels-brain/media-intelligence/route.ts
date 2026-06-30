import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildReelsMediaIntelligenceReport, type ReelsMediaSourceVideo } from "@/lib/factory/reelsBrainMediaIntelligence";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function parseNiches(value: string | null): string[] {
  return Array.from(new Set(String(value || "ru_toys,ru_clothing,ru_cosmetics")
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
        ...buildReelsMediaIntelligenceReport([]),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const sp = req.nextUrl.searchParams;
    const niches = parseNiches(sp.get("niches"));
    const limitPerNiche = Math.min(1000, Math.max(20, Number(sp.get("limit_per_niche") || 500)));
    const rows: ReelsMediaSourceVideo[] = [];
    const warnings: string[] = [];

    for (const niche of niches) {
      const { data, error } = await db
        .from("viral_videos")
        .select("id,url,platform,niche,caption,views,virality_score,analyzed,sound_title,analyzed_full")
        .eq("niche", niche)
        .order("virality_score", { ascending: false, nullsFirst: false })
        .limit(limitPerNiche);
      if (error) {
        warnings.push(`${niche}: ${error.message}`);
        continue;
      }
      const byId = new Map<number, ReelsMediaSourceVideo>();
      for (const row of ((data || []) as ReelsMediaSourceVideo[])) {
        if (row.id != null) byId.set(Number(row.id), row);
      }

      const { data: latestData, error: latestError } = await db
        .from("viral_videos")
        .select("id,url,platform,niche,caption,views,virality_score,analyzed,sound_title,analyzed_full")
        .eq("niche", niche)
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(Math.min(250, limitPerNiche));
      if (latestError) warnings.push(`${niche}: latest ${latestError.message}`);
      for (const row of ((latestData || []) as ReelsMediaSourceVideo[])) {
        if (row.id != null) byId.set(Number(row.id), row);
      }

      rows.push(...byId.values());
    }

    const report = buildReelsMediaIntelligenceReport(rows);
    return NextResponse.json({
      ...report,
      niches,
      limit_per_niche: limitPerNiche,
      warnings,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "media-intelligence reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
