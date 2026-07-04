import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  parseAutomationNiches,
  parseAutomationPlatforms,
  summarizeLoopResult,
} from "@/lib/factory/reelsBrainAutomation";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { persistReelsBrainAutomationRun, summarizeReelsBrainAutomationRuns } from "@/lib/factory/reelsBrainAutomationRuns";
import { parseAnalyzeExecutionIntent, summarizeAnalyzeExecutionIntent, tuneAnalyzeLaneByExecutionIntent } from "@/lib/factory/reelsBrainAnalyzeCompactionPolicy";
import { parseShardConfig, stableBucketMatch } from "@/lib/factory/reelsBrainQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type AnalyzeLane = {
  niche: string;
  platform: "tiktok" | "instagram" | "youtube";
  total: number;
  unanalyzed: number;
  analyzed: number;
  backlog_pct: number;
};

type AnalyzeLaneRow = {
  id?: number;
  url?: string | null;
  niche?: string | null;
  platform?: string | null;
  analyzed?: boolean | null;
};

const SUPABASE_PAGE_SIZE = 1000;
const MAX_ANALYZE_LANE_ROWS = 50000;

function parseBool(value: unknown, fallback = false): boolean {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

async function loadAnalyzeLanes(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  niches: string[],
  platforms: ("tiktok" | "instagram" | "youtube")[],
): Promise<AnalyzeLane[]> {
  const rows: AnalyzeLaneRow[] = [];
  for (let from = 0; from < MAX_ANALYZE_LANE_ROWS; from += SUPABASE_PAGE_SIZE) {
    const to = Math.min(from + SUPABASE_PAGE_SIZE - 1, MAX_ANALYZE_LANE_ROWS - 1);
    const { data, error } = await db
      .from("viral_videos")
      .select("niche,platform,analyzed")
      .in("niche", niches)
      .range(from, to);
    if (error) throw new Error(error.message);
    const page = (data || []) as AnalyzeLaneRow[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  const counts = new Map<string, { total: number; analyzed: number }>();
  for (const row of rows) {
    const niche = String(row.niche || "").trim();
    const platform = String(row.platform || "").trim() as "tiktok" | "instagram" | "youtube";
    if (!niche || !platforms.includes(platform)) continue;
    const key = `${niche}:${platform}`;
    const current = counts.get(key) || { total: 0, analyzed: 0 };
    if (row.analyzed === false) {
      current.total += 1;
    } else {
      current.total += 1;
      current.analyzed += 1;
    }
    counts.set(key, current);
  }

  return niches.flatMap((niche) => platforms.map((platform) => {
    const count = counts.get(`${niche}:${platform}`) || { total: 0, analyzed: 0 };
    const unanalyzed = Math.max(0, count.total - count.analyzed);
    return {
      niche,
      platform,
      total: count.total,
      analyzed: count.analyzed,
      unanalyzed,
      backlog_pct: count.total ? Math.round((unanalyzed / count.total) * 100) : 0,
    };
  })).sort((a, b) =>
    b.unanalyzed - a.unanalyzed
    || b.backlog_pct - a.backlog_pct
    || a.niche.localeCompare(b.niche)
    || a.platform.localeCompare(b.platform)
  );
}

async function cleanupUnselectableTail(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  lane: AnalyzeLane & { analyze_limit: number },
) {
  if (lane.unanalyzed > Math.max(5, lane.analyze_limit)) return { cleaned: 0, ids: [] as number[] };

  const tail: AnalyzeLaneRow[] = [];
  for (let from = 0; from < MAX_ANALYZE_LANE_ROWS; from += SUPABASE_PAGE_SIZE) {
    const to = Math.min(from + SUPABASE_PAGE_SIZE - 1, MAX_ANALYZE_LANE_ROWS - 1);
    const { data, error } = await db
      .from("viral_videos")
      .select("id,url,niche,platform,analyzed")
      .range(from, to);
    if (error) return { cleaned: 0, ids: [] as number[], error: error.message };
    const page = (data || []) as AnalyzeLaneRow[];
    tail.push(...page
      .filter((row) => row.analyzed !== true)
      .filter((row) => String(row.niche || "").trim() === lane.niche)
      .filter((row) => String(row.platform || "").trim().toLowerCase() === lane.platform));
    if (tail.length >= lane.analyze_limit || page.length < SUPABASE_PAGE_SIZE) break;
  }
  const ids = tail.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  if (!ids.length) return { cleaned: 0, ids };

  const { error: updateError } = await db
    .from("viral_videos")
    .update({
      analyzed: true,
      analyzed_full: {
        ok: false,
        source: "reels-brain-analyze-backlog",
        error: "tail cleanup: analyzer selected 0 candidates for this lane",
        cleaned_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (updateError) return { cleaned: 0, ids, error: updateError.message };
  return { cleaned: ids.length, ids };
}

async function runAnalyzeBacklog(req: NextRequest, body: Record<string, unknown>, execute: boolean) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

  const niches = parseAutomationNiches(
    typeof body.niches === "string" ? body.niches : req.nextUrl.searchParams.get("niches"),
    10,
  );
  const platforms = parseAutomationPlatforms(
    typeof body.platforms === "string" ? body.platforms : req.nextUrl.searchParams.get("platforms"),
  ).filter((platform): platform is "tiktok" | "instagram" | "youtube" => platform === "tiktok" || platform === "instagram" || platform === "youtube");
  const maxLanes = Math.max(1, Math.min(9, Number(body.max_lanes || req.nextUrl.searchParams.get("max_lanes") || (execute ? 3 : 9))));
  const limit = Math.max(1, Math.min(25, Number(body.limit || req.nextUrl.searchParams.get("limit") || 8)));
  const buildPatterns = parseBool(body.build_patterns ?? req.nextUrl.searchParams.get("build_patterns"), false);
  const executionIntent = parseAnalyzeExecutionIntent(body.execution_intent);
  const { shardIndex, shardCount } = parseShardConfig({
    shardIndex: body.shard_index ?? req.nextUrl.searchParams.get("shard_index"),
    shardCount: body.shard_count ?? req.nextUrl.searchParams.get("shard_count"),
  });

  const lanes = await loadAnalyzeLanes(db, niches, platforms);
  const queue = lanes
    .filter((lane) => lane.unanalyzed > 0)
    .filter((lane) => stableBucketMatch(`${lane.niche}:${lane.platform}`, shardIndex, shardCount))
    .slice(0, maxLanes)
    .map((lane) => {
      const tunedLane = tuneAnalyzeLaneByExecutionIntent({
        intent: executionIntent,
        lane,
        analyzeLimit: Math.min(limit, lane.unanalyzed),
        buildPatterns,
      });
      return {
        ...lane,
        execution_strategy: tunedLane.strategy,
        analyze_limit: tunedLane.analyze_limit,
        tuned_build_patterns: tunedLane.build_patterns,
        taxonomy_limit: tunedLane.taxonomy_limit,
        pattern_limit: tunedLane.pattern_limit,
        focus_platform: tunedLane.focus_platform,
      };
    });

  const origin = req.nextUrl.origin;
  const cookie = req.headers.get("cookie");
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (cookie) headers.cookie = cookie;

  const runs: unknown[] = execute ? await Promise.all(queue.map(async (lane) => {
      const analyzeResponse = await internalFetch(`${origin}/api/factory/reels-brain/analyze`, {
        method: "POST",
        headers,
          body: JSON.stringify({
            niche: lane.niche,
            platform: lane.platform,
            limit: lane.analyze_limit,
            dry_run: false,
        }),
        signal: AbortSignal.timeout(115000),
      });
      const analyze = await analyzeResponse.json().catch(() => ({}));
      let taxonomy: unknown = null;
      if (analyzeResponse.ok) {
        const taxonomyResponse = await internalFetch(`${origin}/api/factory/jobs/reels-brain-taxonomy-refresh`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            niches: lane.niche,
            limit: lane.taxonomy_limit,
            promote_threshold: 3,
          }),
          signal: AbortSignal.timeout(60000),
        });
        taxonomy = await taxonomyResponse.json().catch(() => ({}));
      }
      let patterns: unknown = null;
      if (lane.tuned_build_patterns && analyzeResponse.ok) {
        const patternsResponse = await internalFetch(`${origin}/api/factory/reels-brain/patterns/build`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            niche: lane.niche,
            platform: lane.focus_platform,
            limit: lane.pattern_limit,
            persist: true,
            execution_intent: executionIntent,
          }),
          signal: AbortSignal.timeout(60000),
        });
        patterns = await patternsResponse.json().catch(() => ({}));
      }
      const analyzeResult = analyze as {
        ok?: boolean;
        niche?: string | null;
        platform?: string | null;
        selected?: number;
        analyzed?: number;
        failed?: number;
        error?: string;
      };
      const cleanup = analyzeResponse.ok
        && Number(analyzeResult.selected || 0) === 0
        && Number(analyzeResult.analyzed || 0) === 0
        ? await cleanupUnselectableTail(db, lane)
        : { cleaned: 0, ids: [] as number[] };
      const analyzedTotal = Number(analyzeResult.analyzed || 0) + Number(cleanup.cleaned || 0);
      const patternsResult = patterns as {
        ok?: boolean;
        niche?: string;
        source_videos?: number;
        persisted?: boolean;
        warning?: string | null;
        error?: string;
        memory?: { patterns?: unknown[]; top_hooks?: unknown[] };
      } | null;
      return {
        niche: lane.niche,
        platform: lane.platform,
        ok: analyzeResponse.ok && analyzeResult.ok !== false,
        plan: {
          queries: [],
          source_limit: 0,
          analyze_limit: lane.analyze_limit,
          execution_strategy: lane.execution_strategy,
          taxonomy_limit: lane.taxonomy_limit,
          pattern_limit: lane.pattern_limit,
          focus_platform: lane.focus_platform,
        },
        metrics: summarizeLoopResult({ analyze, patterns }),
        analyze: {
          ok: analyzeResult.ok,
          niche: analyzeResult.niche,
          platform: analyzeResult.platform,
          selected: Number(analyzeResult.selected || 0) + Number(cleanup.cleaned || 0),
          analyzed: analyzedTotal,
          failed: analyzeResult.failed,
          error: analyzeResult.error,
          tail_cleanup: cleanup,
        },
        taxonomy: taxonomy && typeof taxonomy === "object" ? {
          ok: (taxonomy as { ok?: boolean }).ok,
          selected: Number((taxonomy as { selected?: number }).selected || 0),
          classified: Number((taxonomy as { classified?: number }).classified || 0),
        } : null,
        patterns: patternsResult ? {
          ok: patternsResult.ok,
          niche: patternsResult.niche,
          source_videos: patternsResult.source_videos,
          persisted: patternsResult.persisted,
          pattern_count: Array.isArray(patternsResult.memory?.patterns) ? patternsResult.memory.patterns.length : 0,
          top_hooks_count: Array.isArray(patternsResult.memory?.top_hooks) ? patternsResult.memory.top_hooks.length : 0,
          warning: patternsResult.warning,
          error: patternsResult.error,
        } : null,
        error: analyzeResult.error || null,
      };
    })) : [];

  const automationSummary = summarizeReelsBrainAutomationRuns({
    mode: "analyze",
    strategy: buildPatterns ? "analyze_and_build_patterns" : "analyze_backlog",
    platforms,
    runs: runs as Parameters<typeof summarizeReelsBrainAutomationRuns>[0]["runs"],
    ok: true,
  });
  const automationMemory = execute
    ? await persistReelsBrainAutomationRun({ db, niches, summary: automationSummary })
    : { persisted: 0, errors: [] as string[] };

  return NextResponse.json({
    ok: true,
    mode: "analyze_backlog",
    execute,
    execution_intent: summarizeAnalyzeExecutionIntent(executionIntent),
    niches,
    platforms,
    max_lanes: maxLanes,
    shard_index: shardIndex,
    shard_count: shardCount,
    limit,
    build_patterns: buildPatterns,
    lanes,
    queue,
    runs,
    automation_summary: automationSummary,
    automation_memory: automationMemory,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runAnalyzeBacklog(req, {}, false);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return runAnalyzeBacklog(req, body, body.dry_run === true ? false : true);
}
