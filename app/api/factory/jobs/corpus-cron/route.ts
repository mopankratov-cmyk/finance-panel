import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";

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
      return NextResponse.json({ error: "неверный CRON_SECRET" }, { status: 401 });
    }
    const origin = req.nextUrl.origin;

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

    return NextResponse.json({
      ok: true,
      sync_orbits: orbitsResult.status === "fulfilled" ? orbitsResult.value : { error: String(orbitsResult.reason).slice(0, 100) },
      corpus_tick: tickResult.status === "fulfilled" ? tickResult.value : { error: String(tickResult.reason).slice(0, 100) },
      playbooks: playbooksResult,
    });
  } catch (e) {
    return NextResponse.json({ error: "cron корпуса упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
