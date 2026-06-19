import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { virloSearchResult } from "@/lib/factory/trendSources";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// R3 — кеш Orbit в виральный корпус. После завершённого Orbit (finalized): пишем аналитику+звуки в
// orbit_searches и видео в viral_videos (дедуп по url). Использует только уже рабочие вызовы Virlo
// (get_keyword_search_results) — никаких платных create-операций. POST { job_id, niche?, article? }.
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const jobId: string = (body.job_id || body.id || "").toString().trim();
  if (!jobId) return NextResponse.json({ error: "Нужен job_id Orbit" }, { status: 400 });
  const article: string = (body.article || "").toString().trim();
  const nicheRaw: string = (body.niche || body.product_name || "").toString().trim();
  const niche = nicheFromArticle(article, nicheRaw); // rubric-ниша для консистентности с запросами корпуса

  const status = await virloSearchResult(jobId, "status");
  if (!status) return NextResponse.json({ error: "Virlo не ответил по статусу" }, { status: 502 });
  const finalized = status.finalized === true || status.status === "completed" || status.status === "partial_failure";
  if (!finalized) return NextResponse.json({ finalized: false, status: status.status || "pending" });

  const [analysisR, videosR, soundsR] = await Promise.all([
    virloSearchResult(jobId, "analysis").catch(() => null),
    virloSearchResult(jobId, "videos").catch(() => null),
    virloSearchResult(jobId, "sounds").catch(() => null),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analysis: any = analysisR?.analysis_data || analysisR?.data || analysisR || null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sounds: any[] = (soundsR?.data || (soundsR as any)?.sounds || []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawVids: any[] = (videosR?.data || (videosR as any)?.videos || []) as any[];

  // кеш Orbit-поиска
  const { error: osErr } = await db.from("orbit_searches").upsert({
    job_id: jobId,
    niche,
    article: article || null,
    status: String(status.status || "completed"),
    finalized: true,
    video_count: rawVids.length,
    analysis_summary: analysis || null,
    sounds: sounds.length ? sounds : null,
    fetched_at: new Date().toISOString(),
  }, { onConflict: "job_id" });
  if (osErr) return NextResponse.json({ error: "orbit_searches: " + osErr.message, hint: "миграция 20260620 применена?" }, { status: 500 });

  // видео → viral_videos (дедуп по url). virality_score = ln(views/followers)*ln(followers), если оба есть.
  const rows = rawVids.map((v) => {
    const url = String(v.url || v.video_url || "");
    if (!url) return null;
    const views = num(v.views ?? v.play_count);
    const followers = num(v.followers ?? v.creator_followers ?? v.number_of_followers ?? v.author_followers);
    let score: number | null = null;
    if (views > 0 && followers > 0) { const s = Math.log(views / followers) * Math.log(followers); if (Number.isFinite(s)) score = Math.round(s * 100) / 100; }
    return {
      niche,
      platform: String(v.platform || v.source || "tiktok"),
      url,
      views: views || null,
      likes: num(v.number_of_likes ?? v.likes) || null,
      followers_creator: followers || null,
      virality_score: score,
      caption: (v.description || v.title || v.caption || "").toString().slice(0, 2000) || null,
      sound_id: v.sound_id ? String(v.sound_id) : null,
      sound_title: v.sound_title ? String(v.sound_title) : null,
      source_orbit_id: jobId,
      analyzed: false,
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  let inserted = 0;
  if (rows.length) {
    // upsert по url с ON CONFLICT DO NOTHING (ignoreDuplicates) — дубли пропускаем, существующие НЕ трогаем,
    // чтобы ре-синк не сбросил analyzed/analyzed_full уже разобранного видео (R4). count = только новые вставки.
    const { error: vErr, count } = await db.from("viral_videos").upsert(rows, { onConflict: "url", ignoreDuplicates: true, count: "exact" });
    if (vErr) return NextResponse.json({ error: "viral_videos: " + vErr.message }, { status: 500 });
    inserted = count ?? rows.length;
  }

  return NextResponse.json({ ok: true, job_id: jobId, niche, videos: rows.length, upserted: inserted, sounds: sounds.length, analysis: !!analysis });
}
