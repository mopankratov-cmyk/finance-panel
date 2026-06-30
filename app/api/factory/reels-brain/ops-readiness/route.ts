import { NextRequest, NextResponse } from "next/server";
import { buildReelsBrainOpsReadiness } from "@/lib/factory/reelsBrainOpsReadiness";
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

    const readiness = buildReelsBrainOpsReadiness(rows, corpusCurrent, corpusTarget);
    return NextResponse.json({
      ok: true,
      mode: "reels_brain_ops_readiness_1_5",
      scope: "reels_brain_only",
      niches,
      corpus: { current: corpusCurrent, target: corpusTarget, note: "no corpus growth in this pass" },
      summary: readiness.summary,
      readiness,
      notes: [
        "Закрывает задачи 1-5 как operational foundation внутри Reels Brain.",
        "Offline workers описаны контрактами и guardrails, но не запускаются в Vercel route.",
        "Outcome/discovery/daily-report/dashboard-QA работают как внутренние аналитические слои.",
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "ops-readiness reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
