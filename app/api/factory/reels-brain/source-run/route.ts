import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchViral, hasTrendSource, trendSourceName } from "@/lib/factory/trendSources";
import { makeViralVideoRows, type ReelsBrainInput } from "@/lib/factory/reelsBrain";
import { filterRelevantReelsInputs, summarizeProviderQuality, type ReelsBrainProvider } from "@/lib/factory/reelsBrainSources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { niche, query?, limit? }
// Универсальный первый Source Runner: тянет текущий provider (Virlo/Apify) и пишет clean rows в viral_videos.
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    if (!hasTrendSource()) return NextResponse.json({ error: "источник трендов не настроен: нужен APIFY_TOKEN или VIRLO_API_KEY" }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const niche = String(body.niche || "default").trim() || "default";
    const query = String(body.query || niche).trim().slice(0, 120);
    const limit = Math.min(100, Math.max(1, Number(body.limit || 30)));
    const provider = trendSourceName();

    const videos = await fetchViral(query, limit);
    const inputs = videos.map((v): ReelsBrainInput => ({
      url: v.url,
      platform: v.platform || (provider === "virlo" ? "tiktok" : undefined),
      caption: v.caption || v.title,
      title: v.title,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      shares: v.shares,
      followers: v.followers,
      sound_id: v.sound_id,
      sound_title: v.sound_title,
      published_at: v.published_at,
    }));
    const relevantInputs = filterRelevantReelsInputs(query, inputs);
    const prepared = makeViralVideoRows(relevantInputs, { niche, sourceProvider: provider, sourceQuery: query, sourceType: "provider" });

    let inserted = 0;
    if (prepared.rows.length) {
      const { error, count } = await db
        .from("viral_videos")
        .upsert(prepared.rows, { onConflict: "url", ignoreDuplicates: true, count: "exact" });
      if (error) return NextResponse.json({ error: "viral_videos: " + error.message }, { status: 500 });
      inserted = count ?? prepared.rows.length;
    }

    return NextResponse.json({
      ok: true,
      provider,
      niche,
      query,
      requested: limit,
      found: videos.length,
      relevant: relevantInputs.length,
      normalized: prepared.rows.length,
      inserted,
      rejected: prepared.rejected,
      quality: summarizeProviderQuality(provider as ReelsBrainProvider, query, inputs),
      sample: prepared.rows.slice(0, 8).map((r) => ({ url: r.url, views: r.views, score: r.virality_score })),
    });
  } catch (e) {
    return NextResponse.json({ error: "source-run reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
