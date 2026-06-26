import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { makeViralVideoRows, type ReelsBrainInput } from "@/lib/factory/reelsBrain";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function normalizeBodyVideos(value: unknown): ReelsBrainInput[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? { url: item } : (item && typeof item === "object" ? item as ReelsBrainInput : {}));
}

// POST { niche, videos:[url|{url,caption,views,...}], source_query? }
// Ручной seed для Brain Lab: быстро кладём сильные ссылки в viral_videos без нового schema-layer.
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const niche = String(body.niche || "default").trim() || "default";
    const sourceQuery = String(body.source_query || "manual").trim();
    const videos = normalizeBodyVideos(body.videos);
    if (!videos.length) return NextResponse.json({ error: "нужен массив videos: строки-ссылки или объекты" }, { status: 400 });

    const prepared = makeViralVideoRows(videos, { niche, sourceProvider: "manual", sourceQuery, sourceType: "manual" });
    if (!prepared.rows.length) return NextResponse.json({ ok: true, niche, inserted: 0, rejected: prepared.rejected, warning: "не нашлось валидных URL" });

    const { error, count } = await db
      .from("viral_videos")
      .upsert(prepared.rows, { onConflict: "url", ignoreDuplicates: true, count: "exact" });
    if (error) return NextResponse.json({ error: "viral_videos: " + error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      niche,
      received: videos.length,
      normalized: prepared.rows.length,
      inserted: count ?? prepared.rows.length,
      rejected: prepared.rejected,
      sample: prepared.rows.slice(0, 5).map((r) => ({ url: r.url, score: r.virality_score, platform: r.platform })),
    });
  } catch (e) {
    return NextResponse.json({ error: "manual seed reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
