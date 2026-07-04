import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadReelsBrainPortfolioDigest, parseReelsBrainNiches } from "@/lib/factory/reelsBrainDigest";
import { internalFetch } from "@/lib/internalFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: true, niches: [], warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });

    const niches = parseReelsBrainNiches(req.nextUrl.searchParams.get("niches"));
    const digest = await loadReelsBrainPortfolioDigest(db, niches);
    const progressUrl = new URL("/api/factory/reels-brain/progress", req.nextUrl.origin);
    progressUrl.searchParams.set("niches", niches.join(","));
    const progressResponse = await internalFetch(progressUrl);
    const progressBody = await progressResponse.json().catch(() => ({}));

    return NextResponse.json({
      ok: true,
      ...digest,
      portfolio: {
        ...digest.portfolio,
        pipeline_progress: progressResponse.ok
          ? {
            throughput_24h: progressBody?.throughput_24h || null,
            totals: progressBody?.totals || null,
            platforms: Array.isArray(progressBody?.platforms) ? progressBody.platforms : [],
          }
          : null,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "digest-all reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
