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
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const jobId: string = (body.job_id || body.id || "").toString().trim();
    if (!jobId) return NextResponse.json({ error: "Нужен job_id Orbit" }, { status: 400 });
    const article: string = (body.article || "").toString().trim();
    const nicheRaw: string = (body.niche || body.product_name || "").toString().trim();
    const niche = nicheFromArticle(article, nicheRaw); // rubric-ниша для консистентности с запросами корпуса

    const statusRaw = await virloSearchResult(jobId, "status");
    if (!statusRaw) return NextResponse.json({ error: "Virlo не ответил по статусу" }, { status: 502 });
    // Virlo заворачивает ответ в .data — распаковываем как для analysis/videos/sounds ниже (иначе finalized всегда false)

    const status: any = (statusRaw as any).data || statusRaw;
    const finalized = status.finalized === true || status.status === "completed" || status.status === "partial_failure";
    if (!finalized) return NextResponse.json({ finalized: false, status: status.status || "pending", raw_keys: Object.keys(statusRaw).slice(0, 8) });

    const PAGE = 50;
    const CAP = 200;
    // Видео пагинируются: Virlo отдаёт { data: { total, limit:50, offset, videos:[...] } } (data — ОБЪЕКТ, не массив),
    // а орбиты держат 110-127 видео. Тянем страницами через offset до CAP. extraArgs у virloSearchResult уже есть.

    const videoPages: any[] = [];
    for (let offset = 0; offset < CAP; offset += PAGE) {
      const pageR = await virloSearchResult(jobId, "videos", { limit: PAGE, offset }).catch(() => null);

      const pageData: any = (pageR as any)?.data || pageR;
      // массив на data.videos; терпим и data-как-массив на случай смены формы Virlo

      const pageVids: any[] = Array.isArray(pageData?.videos) ? (pageData.videos as any[]) : (Array.isArray(pageData) ? (pageData as any[]) : []);
      videoPages.push(...pageVids);
      const total = num(pageData?.total);
      if (pageVids.length < PAGE || (total > 0 && videoPages.length >= total)) break;
    }
    const [analysisR, soundsR] = await Promise.all([
      virloSearchResult(jobId, "analysis").catch(() => null),
      virloSearchResult(jobId, "sounds").catch(() => null),
    ]);

    const analysis: any = analysisR?.analysis_data || analysisR?.data || analysisR || null;
    // sounds завёрнуты так же: массив на data.sounds (data — объект). Терпим оба варианта.

    const soundsData: any = (soundsR as any)?.data || soundsR;

    const sounds: any[] = Array.isArray(soundsData?.sounds) ? (soundsData.sounds as any[]) : (Array.isArray(soundsData) ? (soundsData as any[]) : []);

    const rawVids: any[] = videoPages;

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
      // followers и sound лежат во ВЛОЖЕННЫХ объектах author/sound — top-level ключей нет (подтверждено дампом).
      const author = v.author && typeof v.author === "object" ? v.author : {};
      const sound = v.sound && typeof v.sound === "object" ? v.sound : {};
      const views = num(v.views ?? v.play_count);
      const followers = num(
        author.followers ?? author.follower_count ?? author.followers_count ?? author.fans ?? author.fan_count ?? author.number_of_followers ??
        v.followers ?? v.creator_followers ?? v.number_of_followers ?? v.author_followers,
      );
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
        sound_id: sound.id ? String(sound.id) : (sound.sound_id ? String(sound.sound_id) : (v.sound_id ? String(v.sound_id) : null)),
        sound_title: sound.title ? String(sound.title) : (sound.name ? String(sound.name) : (sound.sound_title ? String(sound.sound_title) : (v.sound_title ? String(v.sound_title) : null))),
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
  } catch (e) {
    return NextResponse.json({ error: "corpus/sync-orbit crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
