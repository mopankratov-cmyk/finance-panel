import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { automationRunHistory } from "@/lib/factory/reelsBrainPlaybook";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type PatternBrain = {
  total_videos?: number;
  analyzed_videos?: number;
  meta_brain?: {
    patterns?: unknown[];
    generator_ready_patterns?: unknown[];
    quality_summary?: {
      generator_ready?: number;
      needs_cleanup?: number;
      noise?: number;
      avg_relevance_score?: number;
    };
  };
  cross_platform_patterns?: unknown[];
  platform_brains?: Record<string, {
    total_videos?: number;
    analyzed_videos?: number;
    patterns?: unknown[];
    generator_ready_patterns?: unknown[];
  }>;
};

function splitList(value: unknown): string[] {
  return Array.from(new Set(String(value || "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean)))
    .slice(0, 20);
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unitCost(row: { mode?: string; found?: number; analyzed?: number; retries?: number; errors?: number }) {
  if (row.mode === "analyze") return Math.max(1, num(row.analyzed));
  return Math.max(1, num(row.found) + num(row.retries) * 5 + num(row.errors) * 10);
}

function trendLabel(current: number | null, previous: number | null) {
  if (current == null || previous == null || previous <= 0) return "not_enough_data" as const;
  const delta = (current - previous) / previous;
  if (delta <= -0.08) return "cheaper" as const;
  if (delta >= 0.08) return "more_expensive" as const;
  return "flat" as const;
}

function patternBrain(playbook: unknown): PatternBrain {
  const pb = playbook && typeof playbook === "object" ? playbook as Record<string, unknown> : {};
  return pb.reels_brain_patterns && typeof pb.reels_brain_patterns === "object"
    ? pb.reels_brain_patterns as PatternBrain
    : {};
}

function understandingScore(brain: PatternBrain) {
  const total = num(brain.total_videos);
  const analyzed = num(brain.analyzed_videos);
  const meta = brain.meta_brain || {};
  const patterns = Array.isArray(meta.patterns) ? meta.patterns.length : 0;
  const ready = Array.isArray(meta.generator_ready_patterns) ? meta.generator_ready_patterns.length : num(meta.quality_summary?.generator_ready);
  const cross = Array.isArray(brain.cross_platform_patterns) ? brain.cross_platform_patterns.length : 0;
  const relevance = Math.max(0, Math.min(100, num(meta.quality_summary?.avg_relevance_score)));
  const analyzedRatio = total ? analyzed / total : 0;
  const score = Math.round(
    Math.min(40, analyzedRatio * 40)
    + Math.min(25, ready * 2)
    + Math.min(20, patterns)
    + Math.min(10, cross * 1.5)
    + Math.min(5, relevance / 20)
  );
  return Math.max(0, Math.min(100, score));
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) {
      return NextResponse.json({ ok: true, niches: [], runs: [], warning: "Supabase не настроен" }, { headers: { "Cache-Control": "no-store" } });
    }

    const niches = splitList(req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    const limit = Math.max(4, Math.min(40, Number(req.nextUrl.searchParams.get("limit") || 18)));
    const { data, error } = await db
      .from("niche_playbooks")
      .select("niche,playbook,updated_at")
      .in("niche", niches);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = ((data || []) as { niche?: string; playbook?: unknown; updated_at?: string }[]);
    const runMap = new Map<string, ReturnType<typeof automationRunHistory>[number] & { niches: Set<string> }>();
    const nicheSummaries = rows.map((row) => {
      const brain = patternBrain(row.playbook);
      for (const run of automationRunHistory(row.playbook)) {
        const key = [
          run.created_at,
          run.mode,
          run.strategy || "",
          run.found,
          run.inserted,
          run.analyzed,
          run.errors,
        ].join("|");
        const current = runMap.get(key) || { ...run, niches: new Set<string>() };
        if (row.niche) current.niches.add(row.niche);
        runMap.set(key, current);
      }
      const meta = brain.meta_brain || {};
      return {
        niche: row.niche || "",
        updated_at: row.updated_at || null,
        total_videos: num(brain.total_videos),
        analyzed_videos: num(brain.analyzed_videos),
        patterns: Array.isArray(meta.patterns) ? meta.patterns.length : 0,
        generator_ready_patterns: Array.isArray(meta.generator_ready_patterns) ? meta.generator_ready_patterns.length : num(meta.quality_summary?.generator_ready),
        cross_platform_patterns: Array.isArray(brain.cross_platform_patterns) ? brain.cross_platform_patterns.length : 0,
        avg_relevance_score: num(meta.quality_summary?.avg_relevance_score),
        understanding_score: understandingScore(brain),
        platform_brains: Object.fromEntries(Object.entries(brain.platform_brains || {}).map(([platform, platformBrain]) => [
          platform,
          {
            total_videos: num(platformBrain?.total_videos),
            analyzed_videos: num(platformBrain?.analyzed_videos),
            patterns: Array.isArray(platformBrain?.patterns) ? platformBrain.patterns.length : 0,
            generator_ready_patterns: Array.isArray(platformBrain?.generator_ready_patterns) ? platformBrain.generator_ready_patterns.length : 0,
          },
        ])),
      };
    }).sort((a, b) => b.understanding_score - a.understanding_score || a.niche.localeCompare(b.niche));

    const runs = Array.from(runMap.values())
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(-limit)
      .map((run) => {
        const costUnits = unitCost(run);
        return {
          id: run.id,
          mode: run.mode,
          strategy: run.strategy || null,
          created_at: run.created_at,
          niches: Array.from(run.niches).sort(),
          ok: run.ok,
          found: run.found,
          inserted: run.inserted,
          analyzed: run.analyzed,
          relevant: run.relevant,
          retries: run.retries,
          errors: run.errors,
          best_provider: run.best_provider || null,
          cost_units: costUnits,
          inserted_per_100_cost_units: Math.round((run.inserted / costUnits) * 1000) / 10,
          analyzed_per_100_cost_units: Math.round((run.analyzed / costUnits) * 1000) / 10,
          cost_units_per_inserted: run.inserted > 0 ? Math.round((costUnits / run.inserted) * 10) / 10 : null,
          cost_units_per_analyzed: run.analyzed > 0 ? Math.round((costUnits / run.analyzed) * 10) / 10 : null,
        };
      });

    let cumulativeInserted = 0;
    let cumulativeAnalyzed = 0;
    let cumulativeCost = 0;
    const timeline = runs.map((run) => {
      cumulativeInserted += run.inserted;
      cumulativeAnalyzed += run.analyzed;
      cumulativeCost += run.cost_units;
      return {
        ...run,
        cumulative_inserted: cumulativeInserted,
        cumulative_analyzed: cumulativeAnalyzed,
        cumulative_cost_units: cumulativeCost,
      };
    });

    const intakeRuns = timeline.filter((row) => row.inserted > 0);
    const recentIntake = intakeRuns.slice(-5);
    const previousIntake = intakeRuns.slice(-10, -5);
    const avgRecentCost = recentIntake.length
      ? recentIntake.reduce((sum, row) => sum + (row.cost_units_per_inserted || 0), 0) / recentIntake.length
      : null;
    const avgPreviousCost = previousIntake.length
      ? previousIntake.reduce((sum, row) => sum + (row.cost_units_per_inserted || 0), 0) / previousIntake.length
      : null;
    const totals = {
      total_videos: nicheSummaries.reduce((sum, row) => sum + row.total_videos, 0),
      analyzed_videos: nicheSummaries.reduce((sum, row) => sum + row.analyzed_videos, 0),
      patterns: nicheSummaries.reduce((sum, row) => sum + row.patterns, 0),
      generator_ready_patterns: nicheSummaries.reduce((sum, row) => sum + row.generator_ready_patterns, 0),
      cross_platform_patterns: nicheSummaries.reduce((sum, row) => sum + row.cross_platform_patterns, 0),
      avg_understanding_score: nicheSummaries.length
        ? Math.round(nicheSummaries.reduce((sum, row) => sum + row.understanding_score, 0) / nicheSummaries.length)
        : 0,
      cost_units_per_inserted_recent: avgRecentCost == null ? null : Math.round(avgRecentCost * 10) / 10,
      cost_units_per_inserted_previous: avgPreviousCost == null ? null : Math.round(avgPreviousCost * 10) / 10,
      cost_trend: trendLabel(avgRecentCost, avgPreviousCost),
    };

    return NextResponse.json({
      ok: true,
      niches: nicheSummaries,
      totals,
      timeline,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "learning-economics reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
