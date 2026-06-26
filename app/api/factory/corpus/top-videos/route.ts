import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Топ вирусных видео из корпуса (viral_videos), отсортированных по virality_score.
// GET ?niche=blasters&limit=20&min_score=25
export async function GET(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ videos: [], total: 0, warning: "Supabase не настроен — корпус видео временно пустой" }, { headers: { "Cache-Control": "no-store" } });

  const { searchParams } = req.nextUrl;
  const niche = searchParams.get("niche") || "";
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 20)));
  const minScore = Number(searchParams.get("min_score") || 0);

  try {
    let q = db
      .from("viral_videos")
      .select("id,url,niche,virality_score,analyzed,views,followers_creator,created_at")
      .order("virality_score", { ascending: false })
      .limit(limit);

    if (niche) q = q.eq("niche", niche);
    if (minScore > 0) q = q.gte("virality_score", minScore);

    const { data, error } = await q;
    if (error) return NextResponse.json({ videos: [], total: 0, warning: error.message }, { headers: { "Cache-Control": "no-store" } }); // таблица может ещё не существовать

    const videos = (data || []).map((v) => ({
      id: v.id,
      url: v.url,
      niche: v.niche,
      score: typeof v.virality_score === "number" ? Math.round(v.virality_score * 10) / 10 : null,
      analyzed: v.analyzed,
      views: v.views,
      followers: v.followers_creator,
      created_at: v.created_at,
    }));

    return NextResponse.json({ videos, total: videos.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ videos: [], total: 0, warning: String(e).slice(0, 200) }, { headers: { "Cache-Control": "no-store" } });
  }
  } catch (e) {
    return NextResponse.json({
      videos: [],
      total: 0,
      warning: "топ видео упал: " + String((e as Error)?.message || e).slice(0, 160),
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
