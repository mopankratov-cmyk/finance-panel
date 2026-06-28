import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildAutomationPlan,
  buildCorpusGrowthQueue,
  parseAutomationNiches,
  parseAutomationPlatforms,
  summarizeLoopResult,
  type ReelsBrainCorpusGrowthLane,
} from "@/lib/factory/reelsBrainAutomation";
import { corpusProgress, corpusTargetByPlatform } from "@/lib/factory/reelsBrainCorpusTargets";
import { reelsBrainEnvStatus } from "@/lib/factory/reelsBrainEnv";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { persistReelsBrainAutomationRun, summarizeReelsBrainAutomationRuns } from "@/lib/factory/reelsBrainAutomationRuns";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function parseBodyNiches(body: Record<string, unknown>, fallback: string | null): string[] {
  if (Array.isArray(body.niches)) {
    return parseAutomationNiches(body.niches.map((row) => String(row || "").trim()).filter(Boolean).join(","), 10);
  }
  return parseAutomationNiches(typeof body.niches === "string" ? body.niches : fallback, 10);
}

async function loadGrowthContext(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, niches: string[]) {
  const [{ data: playbooks }, { data: corpusRows }] = await Promise.all([
    db.from("niche_playbooks")
      .select("niche,playbook,updated_at")
      .in("niche", niches)
      .order("updated_at", { ascending: false }),
    db.from("viral_videos")
      .select("niche,platform")
      .in("niche", niches)
      .limit(20000),
  ]);

  const playbookMap = new Map<string, unknown>();
  for (const row of (playbooks as { niche?: string; playbook?: unknown }[] | null) || []) {
    const niche = String(row.niche || "").trim();
    if (!niche || playbookMap.has(niche)) continue;
    playbookMap.set(niche, row.playbook);
  }

  const corpusMap = new Map<string, number>();
  for (const row of (corpusRows as { niche?: string; platform?: string }[] | null) || []) {
    const niche = String(row.niche || "").trim();
    const platform = String(row.platform || "").trim();
    if (!niche || !platform) continue;
    const key = `${niche}:${platform}`;
    corpusMap.set(key, (corpusMap.get(key) || 0) + 1);
  }

  return { playbookMap, corpusMap };
}

async function runGrowth(req: NextRequest, body: Record<string, unknown>, execute: boolean) {
  const db = getSupabaseAdmin();
  if (!db) {
    const env = reelsBrainEnvStatus();
    return NextResponse.json({
      ok: true,
      warning: "Supabase не настроен",
      env,
      next_action: env.supabase.missing.length
        ? `Add ${env.supabase.missing.join(", ")} to the deployment environment and redeploy`
        : "Check Supabase service-role key permissions",
      lanes: [],
      runs: [],
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const origin = req.nextUrl.origin;
  const cookie = req.headers.get("cookie");
  const fanoutHeaders: HeadersInit = { "Content-Type": "application/json" };
  if (cookie) fanoutHeaders.cookie = cookie;

  const niches = parseBodyNiches(body, req.nextUrl.searchParams.get("niches"));
  const platforms = parseAutomationPlatforms(
    typeof body.platforms === "string"
      ? body.platforms
      : req.nextUrl.searchParams.get("platforms"),
  ).filter((platform): platform is Exclude<typeof platform, "unknown"> => platform !== "unknown");
  const mode = String(body.mode || req.nextUrl.searchParams.get("mode") || "daily") === "weekly" ? "weekly" : "daily";
  const requestedMaxLanes = body.max_lanes || req.nextUrl.searchParams.get("max_lanes");
  const maxLanes = Math.max(1, Math.min(12, Number(requestedMaxLanes || (execute ? 2 : 3))));
  const queryCount = body.query_count || req.nextUrl.searchParams.get("query_count") || (execute ? 1 : undefined);
  const sourceLimit = body.source_limit || req.nextUrl.searchParams.get("source_limit") || (execute ? 10 : undefined);
  const analyzeLimit = body.analyze_limit || req.nextUrl.searchParams.get("analyze_limit") || (execute ? 2 : undefined);

  const { playbookMap, corpusMap } = await loadGrowthContext(db, niches);
  const platformTargets = corpusTargetByPlatform();
  const laneTargets = Object.fromEntries(platforms.map((platform) => [
    platform,
    Math.max(1, Math.ceil(platformTargets[platform] / Math.max(1, niches.length))),
  ])) as Record<Exclude<typeof platforms[number], "unknown">, number>;

  const lanes: ReelsBrainCorpusGrowthLane[] = niches.flatMap((niche) =>
    platforms.map((platform) => {
      const current = corpusMap.get(`${niche}:${platform}`) || 0;
      const progress = corpusProgress({ current, target: laneTargets[platform] });
      return {
        niche,
        platform,
        current_videos: current,
        corpus_target: progress.target,
        gap: progress.gap,
        progress_pct: progress.progress_pct,
      };
    }),
  );
  const queue = buildCorpusGrowthQueue({ lanes, max_lanes: maxLanes });
  const planned = queue.map((lane) => ({
    ...lane,
    plan: buildAutomationPlan({
      mode,
      playbook: playbookMap.get(lane.niche),
      niche: lane.niche,
      platform: lane.platform,
      query_count: queryCount == null ? undefined : Number(queryCount),
      source_limit: sourceLimit == null ? undefined : Number(sourceLimit),
      analyze_limit: analyzeLimit == null ? undefined : Number(analyzeLimit),
      current_videos: lane.current_videos,
      target_videos: lane.corpus_target,
    }),
  }));

  const runs: unknown[] = [];
  if (execute) {
    for (const lane of planned) {
      const response = await internalFetch(`${origin}/api/factory/reels-brain/loop`, {
        method: "POST",
        headers: fanoutHeaders,
        body: JSON.stringify({
          niche: lane.niche,
          queries: lane.plan.queries,
          source_limit: lane.plan.source_limit,
          analyze_limit: lane.plan.analyze_limit,
          target_platform: lane.platform,
          auto_relearn: false,
          build_patterns: false,
          persist_patterns: false,
          provider_limit: 1,
          provider_timeout_ms: 15000,
        }),
        signal: AbortSignal.timeout(115000),
      });
      const result = await response.json().catch(() => ({}));
      runs.push({
        niche: lane.niche,
        platform: lane.platform,
        ok: response.ok,
        plan: lane.plan,
        metrics: summarizeLoopResult(result),
        log: Array.isArray((result as { log?: unknown[] }).log) ? ((result as { log?: string[] }).log || []).slice(-8) : [],
        error: (result as { error?: string }).error || null,
      });
    }
  }

  const automationSummary = summarizeReelsBrainAutomationRuns({
    mode: "growth",
    strategy: mode,
    platforms,
    runs: runs as Parameters<typeof summarizeReelsBrainAutomationRuns>[0]["runs"],
    ok: true,
  });
  const automationMemory = execute
    ? await persistReelsBrainAutomationRun({ db, niches, summary: automationSummary })
    : { persisted: 0, errors: [] as string[] };

  return NextResponse.json({
    ok: true,
    env: reelsBrainEnvStatus(),
    mode,
    execute,
    niches,
    platforms,
    max_lanes: maxLanes,
    lanes,
    queue: planned,
    runs,
    automation_summary: automationSummary,
    automation_memory: automationMemory,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runGrowth(req, {}, false);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return runGrowth(req, body, body.dry_run === true ? false : true);
}
