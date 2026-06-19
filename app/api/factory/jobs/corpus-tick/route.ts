import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { virloMonitorData, virloListMonitors, virloAnalyzeVideo } from "@/lib/factory/trendSources";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// R4: Еженедельный тикер корпуса вирального контента.
// 1. Опрашивает Comet-мониторы (niche_monitors) — новые видео → viral_videos (дедуп по url).
// 2. Берёт топ-20 неанализированных видео → analyze_video (beat_structure / hook_text).
// 3. Обновляет last_polled_at мониторов.
//
// Безопасен при отсутствии миграций (graceful degradation):
//   - niche_monitors не применена → пропускает шаг 1.
//   - viral_videos не применена → пропускает шаг 2.
// Вызывается из /api/factory/jobs/corpus-cron (GET, Bearer CRON_SECRET) или из кокпита кнопкой.

const num = (v: unknown) => Number(v) || 0;
// virality_score: ln(views/followers + 1) * ln(followers + 2) — viral punch учитывающий размер аккаунта
function viralityScore(views: number, followers: number): number {
  return Math.round(Math.log((views / Math.max(followers, 100)) + 1) * Math.log(followers + 2) * 10) / 10;
}

export async function POST(req: NextRequest) {
  // Опциональная авторизация: тело может содержать { secret } для вызова из cron-роута
  const body = await req.json().catch(() => ({}));
  const secret = (body.secret || "").toString();
  if (secret && secret !== (process.env.CRON_SECRET || "")) {
    return NextResponse.json({ error: "неверный secret" }, { status: 401 });
  }
  if (!process.env.VIRLO_API_KEY) {
    return NextResponse.json({ error: "VIRLO_API_KEY не настроен" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const log: string[] = [];
  let monitorsPolled = 0;
  let newVideos = 0;
  let analyzed = 0;

  // ── ШАГ 1: Comet-мониторы → новые видео ──────────────────────────────────────────────────────
  try {
    const { data: monitors } = await db.from("niche_monitors").select("monitor_id,niche").eq("status", "active");
    const rows = (monitors as { monitor_id: string; niche: string }[] | null) ?? [];

    if (rows.length) {
      for (const mon of rows) {
        try {
          const videos = await virloMonitorData(mon.monitor_id);
          if (!videos.length) continue;
          monitorsPolled++;

          const toInsert = videos
            .filter((v) => v.url)
            .map((v) => ({
              niche: mon.niche,
              platform: (v.platform || "tiktok") as string,
              url: v.url as string,
              views: num(v.views),
              likes: num(v.likes),
              followers_creator: num(v.followers || v.creator_followers),
              virality_score: viralityScore(num(v.views), num(v.followers || v.creator_followers)),
              caption: (v.description || v.caption || "") as string,
              hook_text: (v.hook_text || "") as string,
              format_detected: (v.format || "") as string,
              sound_id: (v.sound_id || v.music_id || null) as string | null,
              sound_title: (v.sound_title || v.music_title || null) as string | null,
              is_commerce_safe: typeof v.is_commerce_safe === "boolean" ? v.is_commerce_safe : true,
              source_comet_id: mon.monitor_id,
              analyzed: false,
            }));

          if (toInsert.length) {
            const { error } = await db.from("viral_videos").upsert(toInsert, { onConflict: "url", ignoreDuplicates: true });
            if (!error) newVideos += toInsert.length;
          }

          await db.from("niche_monitors").update({ last_polled_at: new Date().toISOString() }).eq("monitor_id", mon.monitor_id);
        } catch (e) { log.push(`монитор ${mon.monitor_id}: ${String(e).slice(0, 80)}`); }
      }
    } else {
      // niche_monitors пустая (R2 ещё не запускали) или таблица не применена
      // Пробуем list из Virlo — вдруг мониторы есть, просто БД ещё пуста
      try {
        const live = await virloListMonitors();
        if (live.length) {
          log.push(`Найдено ${live.length} мониторов в Virlo (не в БД — запусти /api/factory/corpus/init-monitors)`);
        } else {
          log.push("Нет Comet-мониторов (запусти /api/factory/corpus/init-monitors для создания)");
        }
      } catch { log.push("niche_monitors: таблица не применена или Virlo недоступен"); }
    }
  } catch { log.push("ШАГ 1: niche_monitors не применена, пропуск"); }

  // ── ШАГ 2: анализ топ-неанализированных видео → beat_structure / hook_text ──────────────────
  try {
    const { data: unanalyzed } = await db
      .from("viral_videos")
      .select("id,url,niche")
      .eq("analyzed", false)
      .order("virality_score", { ascending: false })
      .limit(15);

    const rows2 = (unanalyzed as { id: string; url: string; niche: string }[] | null) ?? [];
    for (const vid of rows2) {
      try {
        const analysis = await virloAnalyzeVideo(vid.url);
        if (!analysis) continue;
        await db.from("viral_videos").update({
          analyzed: true,
          hook_text: analysis.hook_text || null,
          format_detected: analysis.format_detected || null,
          beat_structure: analysis.beat_structure || null,
          viral_reason: analysis.viral_reason || null,
          is_commerce_safe: typeof analysis.is_commerce_safe === "boolean" ? analysis.is_commerce_safe : true,
        }).eq("id", vid.id);

        // Если хук извлечён — сеем в viral_hooks для хук-турнира (no unique idx → check first)
        if (analysis.hook_text) {
          const niche = vid.niche || nicheFromArticle("", "");
          try {
            const { count } = await db.from("viral_hooks").select("id", { count: "exact", head: true }).eq("niche", niche).eq("hook_text", analysis.hook_text);
            if (!count) await db.from("viral_hooks").insert({ niche, hook_text: analysis.hook_text, viability_score: 2, effectiveness_notes: "from analyze_video" });
          } catch { /* viral_hooks не применена */ }
        }
        analyzed++;
      } catch (e) { log.push(`analyze ${vid.url.slice(0, 50)}: ${String(e).slice(0, 60)}`); }
    }
  } catch { log.push("ШАГ 2: viral_videos не применена, пропуск"); }

  return NextResponse.json({
    ok: true,
    monitors_polled: monitorsPolled,
    new_videos: newVideos,
    analyzed,
    log: log.slice(0, 10),
  });
}
