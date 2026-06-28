import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { virloMonitorData, virloListMonitors, virloAnalyzeVideo } from "@/lib/factory/trendSources";
import { nicheFromArticle } from "@/lib/factory/rubric";
import { internalFetch } from "@/lib/internalFetch";
import { assessSourceRunHealth } from "@/lib/factory/reelsBrainSourceLearning";
import { normalizeTargetPlatform } from "@/lib/factory/reelsBrainPlaybook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// R4 legacy compatibility: еженедельный тикер корпуса вирального контента.
// Главный execution path завода уже переведён на graph-run; этот роут нужен старому cron-цепочечному контуру.
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
  const origin = req.nextUrl.origin;
  const targetPlatform = normalizeTargetPlatform(body.target_platform || body.platform);
  const autoRelearn = body.auto_relearn !== false;

  const log: string[] = [];
  let monitorsPolled = 0;
  let newVideos = 0;
  let analyzed = 0;
  const fallbackSourceRuns: unknown[] = [];
  const fallbackBakeOffs: unknown[] = [];

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

          const obj = (x: unknown): Record<string, unknown> =>
            x && typeof x === "object" ? (x as Record<string, unknown>) : {};
          const toInsert = videos
            .filter((v) => v.url)
            .map((v) => {
              // followers/sound — во вложенных объектах author/sound; top-level ключей нет (подтверждено дампом).
              const author = obj(v.author);
              const sound = obj(v.sound);
              const followers = num(
                author.follower_count ?? author.followers ?? author.followers_count ?? author.fans ?? author.fan_count,
              );
              return {
                niche: mon.niche,
                platform: (v.platform || "tiktok") as string,
                url: v.url as string,
                views: num(v.views),
                likes: num(v.likes),
                followers_creator: followers,
                virality_score: viralityScore(num(v.views), followers),
                caption: (v.description || "") as string,
                sound_id: (sound.id != null ? String(sound.id) : (sound.sound_id != null ? String(sound.sound_id) : null)) as string | null,
                sound_title: (sound.title != null ? String(sound.title) : (sound.name != null ? String(sound.name) : null)) as string | null,
                is_commerce_safe: typeof v.is_commerce_safe === "boolean" ? v.is_commerce_safe : true,
                source_comet_id: mon.monitor_id,
                analyzed: false,
              };
            });

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

        // Если хук извлечён — сеем в viral_hooks для хук-турнира
        // unique idx на (coalesce(niche,''), hook_text) — миграция 20260624_viral_hooks_unique.sql
        if (analysis.hook_text) {
          const niche = vid.niche || nicheFromArticle("", "");
          try {
            await db.from("viral_hooks").upsert(
              { niche, hook_text: analysis.hook_text, viability_score: 2, effectiveness_notes: "from analyze_video" },
              { onConflict: "niche,hook_text", ignoreDuplicates: true }
            );
          } catch {
            // Если unique idx ещё не применён — fallback: check-then-insert
            try {
              const { count } = await db.from("viral_hooks").select("id", { count: "exact", head: true }).eq("niche", niche).eq("hook_text", analysis.hook_text);
              if (!count) await db.from("viral_hooks").insert({ niche, hook_text: analysis.hook_text, viability_score: 2, effectiveness_notes: "from analyze_video" });
            } catch { /* viral_hooks не применена */ }
          }
        }
        analyzed++;
      } catch (e) { log.push(`analyze ${vid.url.slice(0, 50)}: ${String(e).slice(0, 60)}`); }
    }
  } catch { log.push("ШАГ 2: viral_videos не применена, пропуск"); }

  // ── ШАГ 3: fallback intake через source-run, если monitor path ничего не дал ───────────────────
  if (newVideos < 1) {
    try {
      const explicitFallback = Array.isArray(body.fallback_niches)
        ? body.fallback_niches.map((value: unknown) => String(value || "").trim()).filter(Boolean)
        : [];
      let fallbackNiches = explicitFallback;
      if (!fallbackNiches.length) {
        const { data: monitorNiches } = await db.from("niche_monitors").select("niche").eq("status", "active").limit(3);
        fallbackNiches = ((monitorNiches as { niche?: string }[] | null) || []).map((row) => String(row.niche || "").trim()).filter(Boolean);
      }
      if (!fallbackNiches.length) {
        const { data: playbooks } = await db.from("niche_playbooks").select("niche").order("updated_at", { ascending: false }).limit(3);
        fallbackNiches = ((playbooks as { niche?: string }[] | null) || []).map((row) => String(row.niche || "").trim()).filter(Boolean);
      }
      fallbackNiches = Array.from(new Set(fallbackNiches)).slice(0, 2);

      for (const niche of fallbackNiches) {
        const sourceRes = await internalFetch(`${origin}/api/factory/reels-brain/source-run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ niche, query: niche, limit: 10, target_platform: targetPlatform }),
          signal: AbortSignal.timeout(60000),
        });
        const sourceJson = await sourceRes.json().catch(() => ({}));
        fallbackSourceRuns.push({ niche, source_run: sourceJson });
        log.push(sourceRes.ok
          ? `fallback source ${niche}: ${sourceJson.inserted ?? 0}/${sourceJson.found ?? 0}`
          : `fallback source ${niche}: ${sourceJson.error || sourceRes.statusText}`);

        if (sourceRes.ok && autoRelearn) {
          const policy = (sourceJson as {
            relearn_policy?: { min_found?: number; min_relevant?: number; min_inserted?: number; bake_off_limit?: number };
            recommended_queries?: string[];
          }).relearn_policy;
          if (Array.isArray((sourceJson as { recommended_queries?: string[] }).recommended_queries)) {
            log.push(`fallback queries ${niche}: ${((sourceJson as { recommended_queries?: string[] }).recommended_queries || []).slice(0, 3).join(" | ")}`);
          }
          const health = assessSourceRunHealth(
            { ...(sourceJson as Record<string, unknown>), target_platform: targetPlatform },
            {
              min_found: policy?.min_found,
              min_relevant: policy?.min_relevant,
              min_inserted: policy?.min_inserted,
            },
          );
          if (health.should_relearn) {
            const bakeOffRes = await internalFetch(`${origin}/api/factory/reels-brain/bake-off`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                niche,
                queries: [niche],
                limit: Math.max(15, Number(policy?.bake_off_limit || 15)),
                target_platform: targetPlatform,
                persist: false,
                persist_memory: true,
              }),
              signal: AbortSignal.timeout(80000),
            });
            const bakeOffJson = await bakeOffRes.json().catch(() => ({}));
            fallbackBakeOffs.push({ niche, health, bake_off: bakeOffJson });
            log.push(bakeOffRes.ok
              ? `fallback bake-off ${niche}: ${String((bakeOffJson as { best_provider_by_platform?: Record<string, { provider?: string }> }).best_provider_by_platform?.[targetPlatform]?.provider || "none")}`
              : `fallback bake-off ${niche}: ${(bakeOffJson as { error?: string }).error || bakeOffRes.statusText}`);
          }
        }
      }
    } catch (e) {
      log.push(`ШАГ 3 fallback: ${String((e as Error)?.message || e).slice(0, 100)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    target_platform: targetPlatform,
    auto_relearn: autoRelearn,
    monitors_polled: monitorsPolled,
    new_videos: newVideos,
    analyzed,
    fallback_source_runs: fallbackSourceRuns,
    fallback_bake_offs: fallbackBakeOffs,
    log: log.slice(0, 10),
  });
}
