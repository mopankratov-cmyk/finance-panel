import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { virloListOrbits } from "@/lib/factory/trendSources";
import { nicheFromArticle } from "@/lib/factory/rubric";
import { internalFetch } from "@/lib/internalFetch";

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
  try {
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

  // 2. Уже синкнутые — считаем синкнутой ТОЛЬКО орбиту, у которой реально есть видео в viral_videos.
  // Если в orbit_searches лежит только «шапка» без видео (прерванный синк) — НЕ пропускаем, ре-синкаем.
  let alreadySynced = new Set<string>();
  try {
    const { data } = await db.from("viral_videos").select("source_orbit_id").in("source_orbit_id", completed.map((o) => o.id));
    if (data) alreadySynced = new Set((data as { source_orbit_id: string }[]).map((r) => r.source_orbit_id).filter(Boolean));
  } catch {
    // viral_videos не применена — синкаем всё (синк затем вернёт явную ошибку про миграцию)
  }

  const toSync = completed.filter((o) => !alreadySynced.has(o.id));
  const log: string[] = [];
  let synced = 0;

  // 3. Синк каждой несинкнутой орбиты через sync-orbit (дедуп по url внутри)
  for (const orbit of toSync) {
    const niche = nicheFromOrbitName(orbit.name);
    try {
      const r = await internalFetch(`${origin}/api/factory/corpus/sync-orbit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: orbit.id, niche }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) {
        log.push(`✓ ${orbit.name.slice(0, 50)} → ${j.videos ?? 0} видео (${j.upserted ?? 0} новых), ниша: ${niche}`);
        synced++;
      } else if (j.finalized === false) {
        log.push(`… ${orbit.id.slice(0, 8)}: ещё не финализирован (status: ${j.status ?? "pending"})`);
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
  } catch (e) {
    return NextResponse.json({
      ok: false,
      total: 0,
      completed: 0,
      already_synced: 0,
      synced: 0,
      skipped: 0,
      log: ["синхронизация всех orbit-поисков упала: " + String((e as Error)?.message || e).slice(0, 160)],
    }, { status: 500 });
  }
}
