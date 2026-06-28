import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recommendSourceQueries } from "@/lib/factory/reelsBrainPlaybook";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Legacy compatibility cron entry-point для еженедельного тикера корпуса (R4).
// Главный execution path завода уже переведён на graph-run; этот роут оставлен для старых cron/worker hooks.
// Авторизует по Bearer-токену (CRON_SECRET) → дёргает corpus-tick (POST) и возвращает результат.
// Добавить в vercel.json:
//   "crons": [{ "path": "/api/factory/jobs/corpus-cron", "schedule": "0 3 * * 1" }]
// (каждый понедельник в 3:00 UTC)
//
// Порядок шагов (параллельно):
// 1. sync-all-orbits — синкает завершённые Virlo Orbit-поиски в orbit_searches + viral_videos
// 2. corpus-tick — опрашивает Comet-мониторы + анализирует топ-видео (analyze_video)
// После: build-missing-playbooks с refresh_days=7 — строит отсутствующие + обновляет сталые плейбуки

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const secret = process.env.CRON_SECRET || "";
    if (secret && auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const origin = req.nextUrl.origin;
    const db = getSupabaseAdmin();
    const runBakeOff = req.nextUrl.searchParams.get("run_bake_off") !== "false";

    // Запускаем orbit-sync и corpus-tick параллельно (независимы по данным в момент старта)
    const [orbitsResult, tickResult] = await Promise.allSettled([
      internalFetch(`${origin}/api/factory/corpus/sync-all-orbits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(55000),
      }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 100) })),

      internalFetch(`${origin}/api/factory/jobs/corpus-tick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
        signal: AbortSignal.timeout(55000),
      }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 100) })),
    ]);

    // Шаг 2 — после синка: авто-сборка + обновление сталых плейбуков (>7 дней, макс 5 × 20с)
    const playbooksResult = await internalFetch(`${origin}/api/factory/corpus/build-missing-playbooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_days: 7 }),
      signal: AbortSignal.timeout(110000),
    }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 100) }));

    let scheduledBakeOffs: unknown[] = [];
    if (runBakeOff && db) {
      try {
        const { data: playbooks } = await db
          .from("niche_playbooks")
          .select("niche,playbook,updated_at")
          .order("updated_at", { ascending: false })
          .limit(2);
        const rows = (playbooks as { niche?: string; playbook?: unknown }[] | null) || [];
        for (const row of rows) {
          const niche = String(row.niche || "").trim();
          if (!niche) continue;
          for (const platform of ["tiktok", "instagram", "youtube"] as const) {
            const queries = recommendSourceQueries(row.playbook, niche, platform).slice(0, 2);
            const bakeOff = await internalFetch(`${origin}/api/factory/reels-brain/bake-off`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                niche,
                queries,
                target_platform: platform,
                limit: 12,
                persist: false,
                persist_memory: true,
              }),
              signal: AbortSignal.timeout(90000),
            }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 100) }));
            scheduledBakeOffs.push({
              niche,
              platform,
              queries,
              best_provider: (bakeOff as { best_provider_by_platform?: Record<string, { provider?: string }> }).best_provider_by_platform?.[platform]?.provider || null,
              source_memory_updated: (bakeOff as { source_memory_updated?: boolean }).source_memory_updated === true,
              error: (bakeOff as { error?: string }).error || null,
            });
          }
        }
      } catch (e) {
        scheduledBakeOffs = [{ error: String((e as Error)?.message || e).slice(0, 120) }];
      }
    }

    return NextResponse.json({
      ok: true,
      sync_orbits: orbitsResult.status === "fulfilled" ? orbitsResult.value : { error: String(orbitsResult.reason).slice(0, 100) },
      corpus_tick: tickResult.status === "fulfilled" ? tickResult.value : { error: String(tickResult.reason).slice(0, 100) },
      playbooks: playbooksResult,
      scheduled_bake_offs: scheduledBakeOffs,
    });
  } catch (e) {
    return NextResponse.json({ error: "jobs/corpus-cron crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
