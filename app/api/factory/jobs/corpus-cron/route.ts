import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Vercel Cron entry-point для еженедельного тикера корпуса (R4).
// Авторизует по Bearer-токену (CRON_SECRET) → дёргает corpus-tick (POST) и возвращает результат.
// Добавить в vercel.json:
//   "crons": [{ "path": "/api/factory/jobs/corpus-cron", "schedule": "0 3 * * 1" }]
// (каждый понедельник в 3:00 UTC)
//
// Порядок шагов (параллельно):
// 1. sync-all-orbits — синкает завершённые Virlo Orbit-поиски в orbit_searches + viral_videos
// 2. corpus-tick — опрашивает Comet-мониторы + анализирует топ-видео (analyze_video)

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = req.nextUrl.origin;

  // Запускаем orbit-sync и corpus-tick параллельно (независимы по данным в момент старта)
  const [orbitsResult, tickResult] = await Promise.allSettled([
    fetch(`${origin}/api/factory/corpus/sync-all-orbits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(55000),
    }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 100) })),

    fetch(`${origin}/api/factory/jobs/corpus-tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
      signal: AbortSignal.timeout(55000),
    }).then((r) => r.json()).catch((e) => ({ error: String(e).slice(0, 100) })),
  ]);

  // Шаг 2 — после синка: авто-сборка плейбуков для ниш без playbook (макс 3, по 20с на каждый)
  const playbooks_built: string[] = [];
  const db = getSupabaseAdmin();
  if (db) {
    try {
      // Ниши с данными в orbit_searches
      const { data: orbitNiches } = await db.from("orbit_searches").select("niche").limit(20);
      const { data: playbookNiches } = await db.from("niche_playbooks").select("niche").limit(20);
      const have = new Set((playbookNiches ?? []).map((r: { niche: string }) => r.niche));
      const need = [...new Set((orbitNiches ?? []).map((r: { niche: string }) => r.niche))].filter((n) => n && !have.has(n)).slice(0, 3);
      for (const niche of need) {
        try {
          const r = await fetch(`${origin}/api/factory/niche-playbook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ niche }),
            signal: AbortSignal.timeout(20000),
          });
          if (r.ok) playbooks_built.push(niche);
        } catch { /* playbook optional */ }
      }
    } catch { /* niche_playbooks не применена */ }
  }

  return NextResponse.json({
    ok: true,
    sync_orbits: orbitsResult.status === "fulfilled" ? orbitsResult.value : { error: String(orbitsResult.reason).slice(0, 100) },
    corpus_tick: tickResult.status === "fulfilled" ? tickResult.value : { error: String(tickResult.reason).slice(0, 100) },
    playbooks_built,
  });
}
