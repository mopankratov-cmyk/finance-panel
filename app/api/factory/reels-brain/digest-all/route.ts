import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadReelsBrainPortfolioDigest, parseReelsBrainNiches } from "@/lib/factory/reelsBrainDigest";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: true, niches: [], warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });

    const niches = parseReelsBrainNiches(req.nextUrl.searchParams.get("niches"));
    const digest = await loadReelsBrainPortfolioDigest(db, niches);

    return NextResponse.json({
      ok: true,
      ...digest,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "digest-all reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
