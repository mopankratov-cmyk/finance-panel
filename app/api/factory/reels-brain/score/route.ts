import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeReelsVideo, scoreReelsVideo } from "@/lib/factory/reelsBrain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ViralRow = {
  id: number;
  url: string;
  platform: string | null;
  caption: string | null;
  views: number | null;
  likes: number | null;
  followers_creator: number | null;
  sound_id: string | null;
  sound_title: string | null;
};

// POST { niche?, limit? } — пересчитать virality_score для корпуса без изменения analyzed-флагов.
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const niche = String(body.niche || "").trim();
    const limit = Math.min(500, Math.max(1, Number(body.limit || 100)));

    let q = db
      .from("viral_videos")
      .select("id,url,platform,caption,views,likes,followers_creator,sound_id,sound_title")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (niche) q = q.eq("niche", niche);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: "viral_videos: " + error.message }, { status: 500 });

    const updates: { id: number; score: number }[] = [];
    for (const row of ((data || []) as ViralRow[])) {
      const video = normalizeReelsVideo({
        url: row.url,
        platform: row.platform || undefined,
        caption: row.caption || undefined,
        views: row.views,
        likes: row.likes,
        followers_creator: row.followers_creator,
        sound_id: row.sound_id || undefined,
        sound_title: row.sound_title || undefined,
      });
      if (!video) continue;
      updates.push({ id: row.id, score: scoreReelsVideo(video).total });
    }

    let updated = 0;
    for (const item of updates) {
      const { error: upErr } = await db
        .from("viral_videos")
        .update({ virality_score: item.score, updated_at: new Date().toISOString() })
        .eq("id", item.id);
      if (!upErr) updated++;
    }

    return NextResponse.json({ ok: true, niche: niche || null, scanned: (data || []).length, updated, sample: updates.slice(0, 8) });
  } catch (e) {
    return NextResponse.json({ error: "score reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
