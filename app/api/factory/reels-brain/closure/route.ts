import { NextRequest, NextResponse } from "next/server";
import { buildReelsBrainClosure } from "@/lib/factory/reelsBrainClosure";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function splitList(value: unknown): string[] {
  return Array.from(new Set(String(value || "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)))
    .slice(0, 30);
}

async function loadPlaybooks(niches: string[]) {
  const db = getSupabaseAdmin();
  if (!db) return { rows: [], corpusCurrent: 0, error: "Supabase не настроен" };
  const { data, error } = await db
    .from("niche_playbooks")
    .select("niche,playbook,updated_at")
    .in("niche", niches);
  if (error) return { rows: [], corpusCurrent: 0, error: error.message };

  const videos = await db
    .from("viral_videos")
    .select("id", { count: "exact", head: true })
    .in("niche", niches);

  return {
    rows: ((data || []) as { niche?: string; playbook?: unknown; updated_at?: string }[]),
    corpusCurrent: videos.count || 0,
    error: null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const niches = splitList(sp.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    const corpusTarget = Math.max(1000, Math.min(100000, Number(sp.get("corpus_target") || 10000)));
    const { rows, corpusCurrent, error } = await loadPlaybooks(niches);
    if (error) return NextResponse.json({ error }, { status: error.includes("Supabase") ? 500 : 400 });

    const closure = buildReelsBrainClosure(rows, corpusCurrent, corpusTarget);
    return NextResponse.json({
      ok: true,
      mode: "reels_brain_closure_2_10",
      scope: "reels_brain_only",
      niches,
      corpus: { current: corpusCurrent, target: corpusTarget, note: "corpus growth intentionally skipped in this pass" },
      summary: {
        tracks: closure.total_tracks,
        live: closure.closed_live,
        foundation: closure.closed_foundation,
        needs_worker: closure.closed_needs_worker,
      },
      closure,
      notes: [
        "Закрывает задачи 2-10 как внутренние слои Reels Brain.",
        "Не добирает видео и не связывает мозг с контент-заводом.",
        "Worker-задачи закрыты foundation/spec уровнем: реализация offline workers будет отдельным техническим проходом.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "closure reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
