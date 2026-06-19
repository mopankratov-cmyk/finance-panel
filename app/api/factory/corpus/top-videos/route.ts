import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Топ вирусных видео из корпуса (viral_videos), отсортированных по virality_score.
// GET ?niche=blasters&limit=20&min_score=25
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const { searchParams } = req.nextUrl;
  const niche = searchParams.get("niche") || "";
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 20)));
  const minScore = Number(searchParams.get("min_score") || 0);

  try {
    let q = db
      .from("viral_videos")
      .select("id,url,niche,virality_score,analyzed,views,followers,created_at")
      .order("virality_score", { ascending: false })
      .limit(limit);

    if (niche) q = q.eq("niche", niche);
    if (minScore > 0) q = q.gte("virality_score", minScore);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message, videos: [] }, { status: 200 }); // таблица может ещё не существовать

    const videos = (data || []).map((v) => ({
      id: v.id,
      url: v.url,
      niche: v.niche,
      score: typeof v.virality_score === "number" ? Math.round(v.virality_score * 10) / 10 : null,
      analyzed: v.analyzed,
      views: v.views,
      followers: v.followers,
      created_at: v.created_at,
    }));

    return NextResponse.json({ videos, total: videos.length });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200), videos: [] }, { status: 200 });
  }
}
