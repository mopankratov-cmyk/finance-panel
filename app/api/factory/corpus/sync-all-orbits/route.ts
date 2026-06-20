import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { virloListOrbits } from "@/lib/factory/trendSources";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Пакетная синхронизация всех завершённых Orbit-поисков в orbital_searches + viral_videos.
// POST {} — без тела. Читает список из Virlo (бесплатно), затем синкает только несинкнутые.
// Уже синкнутые (job_id есть в orbit_searches) — пропускаем, чтобы не сбросить analyzed-флаги.

function nicheFromOrbitName(name: string): string {
  // Orbit-имена начинаются "factory <keywords>", так что просто прогоняем через rubric
  return nicheFromArticle("", name.replace(/^factory\s+/i, ""));
}

export async function POST(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  // Получаем URL для self-call sync-orbit
  const origin = req.nextUrl.origin;

  // 1. Список орбит из Virlo (бесплатно)
  let orbits: { id: string; name: string; status: string; totalVideos: number }[] = [];
  try {
    orbits = await virloListOrbits(100);
  } catch (e) {
    return NextResponse.json({ error: "virloListOrbits: " + String(e).slice(0, 120) }, { status: 502 });
  }

  const completed = orbits.filter((o) => (o.status === "completed" || o.status === "partial_failure") && o.totalVideos > 0);
  if (!completed.length) {
    return NextResponse.json({ ok: true, total: orbits.length, completed: 0, synced: 0, skipped: 0, log: ["Нет завершённых Orbit с видео"] });
  }

  // 2. Уже синкнутые — берём из orbit_searches, чтобы пропустить повторно
  let alreadySynced = new Set<string>();
  try {
    const { data } = await db.from("orbit_searches").select("job_id").in("job_id", completed.map((o) => o.id));
    if (data) alreadySynced = new Set((data as { job_id: string }[]).map((r) => r.job_id));
  } catch {
    // orbit_searches не применена — синкаем всё
  }

  const toSync = completed.filter((o) => !alreadySynced.has(o.id));
  const log: string[] = [];
  let synced = 0;

  // 3. Синк каждой несинкнутой орбиты через sync-orbit (дедуп по url внутри)
  for (const orbit of toSync) {
    const niche = nicheFromOrbitName(orbit.name);
    try {
      const r = await fetch(`${origin}/api/factory/corpus/sync-orbit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: orbit.id, niche }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        log.push(`✓ ${orbit.name.slice(0, 50)} → ${j.videos ?? 0} видео (${j.upserted ?? 0} новых), ниша: ${niche}`);
        synced++;
      } else {
        log.push(`✗ ${orbit.id.slice(0, 8)}: ${j.error || r.statusText}`);
      }
    } catch (e) {
      log.push(`✗ ${orbit.id.slice(0, 8)}: ${String(e).slice(0, 80)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    total: orbits.length,
    completed: completed.length,
    already_synced: alreadySynced.size,
    synced,
    skipped: toSync.length - synced,
    log,
  });
}
