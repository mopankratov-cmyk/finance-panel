import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type CorpusRow = {
  id: number;
  url: string;
  platform: string | null;
  niche: string | null;
  caption: string | null;
  views: number | null;
  likes: number | null;
  followers_creator: number | null;
  virality_score: number | null;
  analyzed: boolean;
  hook_text: string | null;
  format_detected: string | null;
  sound_title: string | null;
  source_orbit_id: string | null;
  video_url?: string | null;
  download_url?: string | null;
  media_url?: string | null;
  audio_url?: string | null;
  analyzed_full?: unknown;
  created_at: string;
};

// GET ?niche=&limit=&min_score= — компактная панель качества корпуса для скрытого Brain Lab.
export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: true, videos: [], total: 0, warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });
    const sp = req.nextUrl.searchParams;
    const niche = String(sp.get("niche") || "").trim();
    const limit = Math.min(200, Math.max(1, Number(sp.get("limit") || 50)));
    const minScore = Number(sp.get("min_score") || 0);

    let q = db
      .from("viral_videos")
      .select("id,url,platform,niche,caption,views,likes,followers_creator,virality_score,analyzed,hook_text,format_detected,sound_title,source_orbit_id,video_url,download_url,media_url,audio_url,analyzed_full,created_at")
      .order("virality_score", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (niche) q = q.eq("niche", niche);
    if (Number.isFinite(minScore) && minScore > 0) q = q.gte("virality_score", minScore);
    const { data, error } = await q;
    if (error) return NextResponse.json({ ok: true, videos: [], total: 0, warning: error.message }, { headers: { "Cache-Control": "no-store" } });

    const rows = ((data || []) as CorpusRow[]);
    const byPlatform: Record<string, number> = {};
    let analyzed = 0;
    for (const row of rows) {
      const key = row.platform || "unknown";
      byPlatform[key] = (byPlatform[key] || 0) + 1;
      if (row.analyzed) analyzed++;
    }

    return NextResponse.json({
      ok: true,
      niche: niche || null,
      total: rows.length,
      summary: {
        by_platform: byPlatform,
        analyzed,
        unanalyzed: rows.length - analyzed,
        avg_score: rows.length ? Math.round(rows.reduce((sum, r) => sum + Number(r.virality_score || 0), 0) / rows.length * 10) / 10 : 0,
      },
      videos: rows.map((r) => ({
        id: r.id,
        url: r.url,
        platform: r.platform,
        niche: r.niche,
        score: r.virality_score == null ? null : Math.round(Number(r.virality_score) * 10) / 10,
        views: r.views,
        likes: r.likes,
        followers: r.followers_creator,
        analyzed: r.analyzed,
        hook: r.hook_text,
        format: r.format_detected,
        sound: r.sound_title,
        source: r.source_orbit_id,
        video_url: r.video_url || null,
        download_url: r.download_url || null,
        media_url: r.media_url || null,
        audio_url: r.audio_url || null,
        analyzed_full: r.analyzed_full || null,
        caption: r.caption ? r.caption.slice(0, 220) : null,
        created_at: r.created_at,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: true, videos: [], total: 0, warning: "corpus reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { headers: { "Cache-Control": "no-store" } });
  }
}
