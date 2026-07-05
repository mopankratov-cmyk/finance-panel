import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { REELS_BRAIN_CORPUS_TARGET_TOTAL } from "@/lib/factory/reelsBrainCorpusTargets";
import { buildReelsBrainCronExecutionIntent } from "@/lib/factory/reelsBrainCronExecutionIntent";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_NICHES = "ru_toys,ru_clothing,ru_cosmetics";
const DEFAULT_PLATFORMS = "tiktok,instagram,youtube";
const DEFAULT_TARGET_TOTAL = REELS_BRAIN_CORPUS_TARGET_TOTAL;
const DEFAULT_MAX_BACKLOG_BEFORE_ANALYZE = 120;
const SUPABASE_PAGE_SIZE = 1000;
const MAX_BACKLOG_ROWS = 50000;

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstNonEmptyRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = rec(value);
    if (Object.keys(record).length) return record;
  }
  return {};
}

function forcedTask(req: NextRequest): "bulk" | "analyze" | null {
  const raw = String(req.nextUrl.searchParams.get("task") || req.nextUrl.searchParams.get("mode") || "").trim().toLowerCase();
  if (raw === "bulk" || raw === "ingest") return "bulk";
  if (raw === "analyze" || raw === "analysis") return "analyze";
  return null;
}

function normalizedPlanTask(value: unknown): "bulk" | "analyze" | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (["collect_smart_batch", "collect_support_for_decision_segment", "collect_portfolio_gaps", "bulk"].includes(raw)) return "bulk";
  if (["analyze_backlog", "build_patterns", "wait_or_repair_sources", "analyze"].includes(raw)) return "analyze";
  return null;
}

function numberParam(req: NextRequest, name: string, fallback: number, min: number, max: number): number {
  const value = Number(req.nextUrl.searchParams.get(name) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function splitParam(value: string): string[] {
  return value
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
}

function adaptiveCronProfile(input: {
  autoTask: "bulk" | "analyze";
  backlog: { total?: number; analyzed?: number; unanalyzed?: number } | null;
  progress: Record<string, unknown> | null;
}) {
  const totals = rec(input.progress?.totals);
  const mediaBacklog = Number(totals.media_backlog || 0);
  const audioBacklog = Number(totals.audio_backlog || 0);
  const transcriptBacklog = Number(totals.transcript_backlog || 0);
  const analyzeBacklog = Number(totals.analyze_backlog || input.backlog?.unanalyzed || 0);
  const corpusTotal = Number(totals.total || input.backlog?.total || 0);

  const preflight = {
    media_limit: mediaBacklog >= 120 ? 3 : mediaBacklog >= 24 ? 2 : mediaBacklog > 0 ? 1 : 0,
    media_scan: mediaBacklog >= 120 ? 48 : mediaBacklog >= 24 ? 24 : 12,
    audio_limit: audioBacklog + transcriptBacklog >= 180 ? 6 : audioBacklog + transcriptBacklog >= 60 ? 4 : audioBacklog + transcriptBacklog > 0 ? 2 : 0,
    audio_scan: audioBacklog + transcriptBacklog >= 180 ? 72 : audioBacklog + transcriptBacklog >= 60 ? 42 : 24,
    deep_only: audioBacklog + transcriptBacklog >= 120,
  };

  if (input.autoTask === "analyze") {
    return {
      task: "analyze" as const,
      body: {
        max_lanes: analyzeBacklog >= 500 ? 6 : analyzeBacklog >= 180 ? 4 : 3,
        limit: analyzeBacklog >= 500 ? 24 : analyzeBacklog >= 180 ? 18 : 12,
        build_patterns: analyzeBacklog <= 24,
      },
      preflight,
      reason: `adaptive analyze profile: corpus=${corpusTotal}, analyze_backlog=${analyzeBacklog}, audio_backlog=${audioBacklog}, media_backlog=${mediaBacklog}`,
    };
  }

  return {
    task: "bulk" as const,
    body: {
      max_lanes: corpusTotal < 2500 ? 6 : corpusTotal < 6000 ? 5 : 4,
      limit: corpusTotal < 2500 ? 60 : corpusTotal < 6000 ? 45 : 30,
      providers_per_lane: mediaBacklog + audioBacklog > 0 ? 1 : corpusTotal < 2500 ? 2 : 1,
      query_variants_per_lane: corpusTotal < 2500 ? 3 : corpusTotal < 6000 ? 2 : 1,
      provider_timeout_ms: mediaBacklog > 0 ? 18000 : 15000,
      max_provider_calls: corpusTotal < 2500 ? 12 : 8,
      max_cost_units: corpusTotal < 2500 ? 30 : 18,
    },
    preflight,
    reason: `adaptive bulk profile: corpus=${corpusTotal}, media_backlog=${mediaBacklog}, audio_backlog=${audioBacklog}, analyze_backlog=${analyzeBacklog}`,
  };
}

async function loadPipelineProgress(req: NextRequest, niches: string) {
  try {
    const url = new URL("/api/factory/reels-brain/progress", req.nextUrl.origin);
    url.searchParams.set("niches", niches);
    const response = await internalFetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, data: null as Record<string, unknown> | null, error: data?.error || response.statusText };
    return { ok: true, data: data as Record<string, unknown>, error: null as string | null };
  } catch (error) {
    return { ok: false, data: null as Record<string, unknown> | null, error: String((error as Error)?.message || error).slice(0, 160) };
  }
}

async function loadLearningPlan(req: NextRequest, input: {
  niches: string;
  platforms: string;
  targetTotal: number;
  maxBacklogBeforeAnalyze: number;
}) {
  try {
    const url = new URL("/api/factory/reels-brain/learning-plan", req.nextUrl.origin);
    url.searchParams.set("niches", input.niches);
    url.searchParams.set("platforms", input.platforms);
    url.searchParams.set("target", String(input.targetTotal));
    url.searchParams.set("max_backlog_before_analyze", String(input.maxBacklogBeforeAnalyze));
    const response = await internalFetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, data: null as Record<string, unknown> | null, error: data?.error || response.statusText };
    return { ok: true, data: data as Record<string, unknown>, error: null as string | null };
  } catch (error) {
    return { ok: false, data: null as Record<string, unknown> | null, error: String((error as Error)?.message || error).slice(0, 160) };
  }
}

async function runPipelinePreflight(req: NextRequest, input: {
  niches: string;
  progress: { ok: boolean; data: Record<string, unknown> | null };
  profile: { media_limit: number; media_scan: number; audio_limit: number; audio_scan: number; deep_only: boolean };
}) {
  const totals = rec(input.progress.data?.totals);
  const platforms = Array.isArray(input.progress.data?.platforms) ? input.progress.data?.platforms.map((row) => rec(row)) : [];
  const segments = Array.isArray(input.progress.data?.segment_watchlist) ? input.progress.data?.segment_watchlist.map((row) => rec(row)) : [];
  const mediaSegmentTargets = [...segments]
    .filter((row) => Number(row.total_backlog || 0) > 0 && String(rec(row.dominant_gap).key || "") === "media")
    .sort((a, b) => Number(b.total_backlog || 0) - Number(a.total_backlog || 0))
    .slice(0, input.profile.media_limit >= 3 ? 2 : 1);
  const audioSegmentTargets = [...segments]
    .filter((row) => Number(row.total_backlog || 0) > 0 && ["audio", "transcript"].includes(String(rec(row.dominant_gap).key || "")))
    .sort((a, b) => Number(b.total_backlog || 0) - Number(a.total_backlog || 0))
    .slice(0, input.profile.audio_limit >= 4 ? 2 : 1);
  const mediaTargets = mediaSegmentTargets.length
    ? mediaSegmentTargets
    : [...platforms]
        .filter((row) => Number(row.media_backlog || 0) > 0)
        .sort((a, b) => Number(b.media_backlog || 0) - Number(a.media_backlog || 0))
        .slice(0, input.profile.media_limit >= 3 ? 2 : 1);
  const audioTargets = audioSegmentTargets.length
    ? audioSegmentTargets
    : [...platforms]
        .filter((row) => Number(row.audio_backlog || 0) + Number(row.transcript_backlog || 0) > 0)
        .sort((a, b) =>
          (Number(b.audio_backlog || 0) + Number(b.transcript_backlog || 0))
          - (Number(a.audio_backlog || 0) + Number(a.transcript_backlog || 0)))
        .slice(0, input.profile.audio_limit >= 4 ? 2 : 1);
  const needsAudio = Number(totals.audio_backlog || 0) > 0 || Number(totals.transcript_backlog || 0) > 0;

  const result: Record<string, unknown> = {
    progress_totals: totals,
  };

  if (mediaTargets.length && input.profile.media_limit > 0) {
    const perPlatformLimit = Math.max(1, Math.ceil(input.profile.media_limit / mediaTargets.length));
    const mediaTicks = [];
    for (const target of mediaTargets) {
      const mediaUrl = new URL("/api/factory/jobs/reels-brain-media-backfill", req.nextUrl.origin);
      mediaUrl.searchParams.set("niches", String(target.niche || input.niches));
      mediaUrl.searchParams.set("platform", String(target.platform || ""));
      mediaUrl.searchParams.set("limit", String(perPlatformLimit));
      mediaUrl.searchParams.set("scan", String(input.profile.media_scan));
      mediaUrl.searchParams.set("use_local_resolver", "1");
      mediaUrl.searchParams.set("priority", "smart");
      const response = await internalFetch(mediaUrl);
      const body = await response.json().catch(() => ({}));
      mediaTicks.push({
        ok: response.ok && body?.ok !== false,
        niche: String(target.niche || ""),
        platform: String(target.platform || ""),
        attempted: body?.attempted ?? null,
        rows_with_media: body?.rows_with_media ?? null,
        inserted: body?.inserted ?? null,
        enriched: body?.enriched ?? null,
        error: body?.error || null,
      });
    }
    result.media_tick = mediaTicks[0] || null;
    result.media_ticks = mediaTicks;
  }

  if (needsAudio && audioTargets.length && input.profile.audio_limit > 0) {
    const perPlatformLimit = Math.max(1, Math.ceil(input.profile.audio_limit / audioTargets.length));
    const audioTicks = [];
    for (const target of audioTargets) {
      const audioUrl = new URL("/api/factory/jobs/reels-brain-audio-backfill", req.nextUrl.origin);
      audioUrl.searchParams.set("niches", String(target.niche || input.niches));
      audioUrl.searchParams.set("platform", String(target.platform || ""));
      audioUrl.searchParams.set("limit", String(perPlatformLimit));
      audioUrl.searchParams.set("scan", String(input.profile.audio_scan));
      audioUrl.searchParams.set("transcribe", "1");
      audioUrl.searchParams.set("priority", "smart");
      audioUrl.searchParams.set("deep_only", input.profile.deep_only ? "1" : "0");
      const response = await internalFetch(audioUrl);
      const body = await response.json().catch(() => ({}));
      audioTicks.push({
        ok: response.ok && body?.ok !== false,
        niche: String(target.niche || ""),
        platform: String(target.platform || ""),
        extracted: body?.extracted ?? null,
        transcript_ready: body?.transcript_ready ?? null,
        failed: body?.failed ?? null,
        attempted: Array.isArray(body?.runs) ? body.runs.length : null,
        error: body?.error || null,
      });
    }
    result.audio_tick = audioTicks[0] || null;
    result.audio_ticks = audioTicks;
  }

  return result;
}

async function loadBacklogTotals(input: { niches: string; platforms: string }) {
  const db = getSupabaseAdmin();
  if (!db) return { total: 0, analyzed: 0, unanalyzed: 0, error: "Supabase не настроен" };
  const niches = splitParam(input.niches);
  const platforms = new Set(splitParam(input.platforms));
  const summary = { total: 0, analyzed: 0, unanalyzed: 0 };

  for (let from = 0; from < MAX_BACKLOG_ROWS; from += SUPABASE_PAGE_SIZE) {
    const to = Math.min(from + SUPABASE_PAGE_SIZE - 1, MAX_BACKLOG_ROWS - 1);
    const { data, error } = await db
      .from("viral_videos")
      .select("niche,platform,analyzed")
      .in("niche", niches)
      .range(from, to);
    if (error) return { ...summary, error: error.message };
    const page = (data || []) as Array<{ niche?: string | null; platform?: string | null; analyzed?: boolean | null }>;
    for (const row of page) {
      const platform = String(row.platform || "").trim();
      if (!platforms.has(platform)) continue;
      summary.total += 1;
      if (row.analyzed === false) summary.unanalyzed += 1;
      else summary.analyzed += 1;
    }
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return summary;
}

async function selectAutoTask(
  req: NextRequest,
  niches: string,
  platforms: string,
): Promise<{
  task: "bulk" | "analyze";
  targetTotal: number;
  maxBacklogBeforeAnalyze: number;
  backlog: { total: number; analyzed: number; unanalyzed: number; error?: string } | null;
  decision: string;
}> {
  const forced = forcedTask(req);
  const targetTotal = numberParam(req, "target", DEFAULT_TARGET_TOTAL, 1000, 10000);
  const maxBacklogBeforeAnalyze = numberParam(req, "max_backlog_before_analyze", DEFAULT_MAX_BACKLOG_BEFORE_ANALYZE, 1, 1000);

  if (forced) {
    return {
      task: forced,
      targetTotal,
      maxBacklogBeforeAnalyze,
      backlog: null,
      decision: `forced ${forced}`,
    };
  }

  const backlog = await loadBacklogTotals({ niches, platforms });
  const task = backlog.total >= targetTotal || backlog.unanalyzed > maxBacklogBeforeAnalyze ? "analyze" : "bulk";

  return {
    task,
    targetTotal,
    maxBacklogBeforeAnalyze,
    backlog,
    decision: task === "bulk"
      ? `corpus ${backlog.total}/${targetTotal}, backlog ${backlog.unanalyzed} <= ${maxBacklogBeforeAnalyze}: grow corpus`
      : `corpus ${backlog.total}/${targetTotal}, backlog ${backlog.unanalyzed}: analyze memory`,
  };
}

async function loadAutopilotGuard(req: NextRequest, niches: string) {
  try {
    const url = new URL("/api/factory/reels-brain/autopilot-actions", req.nextUrl.origin);
    url.searchParams.set("niches", niches);
    const response = await internalFetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, can_run_paid_collection: false, reason: data?.error || response.statusText, data };
    const canRun = data?.autopilot_actions?.can_run_paid_collection !== false
      && data?.cost_governor?.status !== "pause_or_review";
    return {
      ok: true,
      can_run_paid_collection: canRun,
      reason: canRun ? "autopilot_guard_ok" : "cost_governor_or_autopilot_paused",
      data,
    };
  } catch (error) {
    return {
      ok: false,
      can_run_paid_collection: true,
      reason: "autopilot_guard_error: " + String((error as Error)?.message || error).slice(0, 120),
      data: null,
    };
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const niches = req.nextUrl.searchParams.get("niches") || DEFAULT_NICHES;
    const platforms = req.nextUrl.searchParams.get("platforms") || DEFAULT_PLATFORMS;
    const auto = await selectAutoTask(req, niches, platforms);
    const learningPlan = await loadLearningPlan(req, {
      niches,
      platforms,
      targetTotal: auto.targetTotal,
      maxBacklogBeforeAnalyze: auto.maxBacklogBeforeAnalyze,
    });
    const nextTick = rec(learningPlan.data?.learning_plan)?.next_tick && typeof rec(learningPlan.data?.learning_plan).next_tick === "object"
      ? rec(rec(learningPlan.data?.learning_plan).next_tick)
      : {};
    const plannedTask = forcedTask(req) ? null : normalizedPlanTask(nextTick.task);
    const desiredTask = plannedTask || auto.task;
    const pipelineProgress = await loadPipelineProgress(req, niches);
    const adaptiveProfile = adaptiveCronProfile({ autoTask: desiredTask, backlog: auto.backlog, progress: pipelineProgress.data });
    const preflight = pipelineProgress.ok ? await runPipelinePreflight(req, { niches, progress: pipelineProgress, profile: adaptiveProfile.preflight }) : null;
    const guard = desiredTask === "bulk" ? await loadAutopilotGuard(req, niches) : null;
    const task = desiredTask === "bulk" && guard?.ok && !guard.can_run_paid_collection ? "analyze" : desiredTask;
    const executionIntent = buildReelsBrainCronExecutionIntent({
      task,
      nextTick,
    });
    const endpoint = task === "bulk"
      ? "/api/factory/jobs/reels-brain-bulk-ingest"
      : "/api/factory/jobs/reels-brain-analyze-backlog";
    const planParams = rec(nextTick.params);
    const targetedNiche = String(planParams.niche || "").trim();
    const targetedPlatform = String(planParams.platform || "").trim();
    const effectiveNiches = targetedNiche ? targetedNiche : niches;
    const effectivePlatforms = targetedPlatform ? targetedPlatform : platforms;
    const body = task === "bulk"
      ? {
        niches: effectiveNiches,
        platforms: effectivePlatforms,
        max_lanes: Math.max(1, Math.min(6, Number(executionIntent.bulk_overrides?.max_lanes ?? adaptiveProfile.body.max_lanes))),
        limit: Math.max(1, Math.min(80, Number(planParams.limit || executionIntent.bulk_overrides?.limit || adaptiveProfile.body.limit))),
        providers_per_lane: Math.max(1, Math.min(3, Number(executionIntent.bulk_overrides?.providers_per_lane ?? adaptiveProfile.body.providers_per_lane))),
        query_variants_per_lane: Math.max(1, Math.min(3, Number(executionIntent.bulk_overrides?.query_variants_per_lane ?? adaptiveProfile.body.query_variants_per_lane))),
        provider_timeout_ms: Math.max(5000, Math.min(30000, Number(executionIntent.bulk_overrides?.provider_timeout_ms ?? adaptiveProfile.body.provider_timeout_ms))),
        max_provider_calls: Math.max(1, Math.min(50, Number(executionIntent.bulk_overrides?.max_provider_calls ?? adaptiveProfile.body.max_provider_calls))),
        max_cost_units: Math.max(1, Math.min(200, Number(executionIntent.bulk_overrides?.max_cost_units ?? adaptiveProfile.body.max_cost_units))),
        hours: Math.max(12, Math.min(168, Number(executionIntent.bulk_overrides?.hours ?? 72))),
        execution_intent: executionIntent,
      }
      : {
        niches: effectiveNiches,
        platforms: effectivePlatforms,
        max_lanes: Math.max(1, Math.min(9, Number(executionIntent.analyze_overrides?.max_lanes ?? adaptiveProfile.body.max_lanes))),
        limit: Math.max(1, Math.min(25, Number(planParams.limit || executionIntent.analyze_overrides?.limit || adaptiveProfile.body.limit))),
        build_patterns: typeof planParams.build_patterns === "string" || typeof planParams.build_patterns === "boolean"
          ? ["1", "true", "yes", "on"].includes(String(planParams.build_patterns).toLowerCase())
          : Boolean(executionIntent.analyze_overrides?.build_patterns ?? adaptiveProfile.body.build_patterns),
        execution_intent: executionIntent,
      };

    const response = await internalFetch(`${req.nextUrl.origin}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(115000),
    });
    const result = await response.json().catch(() => ({}));
    const resultRecord = rec(result);
    const nestedResultRecord = rec(resultRecord.result);
    const tickRecord = firstNonEmptyRecord(
      resultRecord.tick,
      nestedResultRecord.tick,
      nestedResultRecord,
      resultRecord,
    );
    const summaryRecord = firstNonEmptyRecord(
      tickRecord.automation_summary,
      nestedResultRecord.automation_summary,
      resultRecord.automation_summary,
    );
    console.info("reels_brain_cron_tick", JSON.stringify({
      task,
      decision: auto.decision,
      planned_task: nextTick.task || null,
      planned_reason: nextTick.reason || null,
      planned_priority_segment: nextTick.priority_segment || null,
      planned_portfolio_segment: nextTick.portfolio_priority_segment || null,
      execution_intent: executionIntent,
      adaptive_profile: adaptiveProfile,
      guard: guard ? { ok: guard.ok, can_run_paid_collection: guard.can_run_paid_collection, reason: guard.reason } : null,
      pipeline_progress_ok: pipelineProgress.ok,
      pipeline_preflight: preflight,
      target_total: auto.targetTotal,
      backlog: auto.backlog,
      endpoint,
      status: response.status,
      ok: response.ok && (result as { ok?: boolean }).ok !== false,
      found: tickRecord.found ?? summaryRecord.found ?? null,
      inserted: tickRecord.inserted ?? summaryRecord.inserted ?? null,
      enriched: tickRecord.enriched ?? summaryRecord.enriched ?? null,
      analyzed: tickRecord.analyzed ?? summaryRecord.analyzed ?? null,
      errors: tickRecord.errors ?? summaryRecord.errors ?? null,
      discovery_learning: Array.isArray(tickRecord.discovery_learning)
        ? tickRecord.discovery_learning.length
        : Array.isArray(nestedResultRecord.discovery_learning)
          ? nestedResultRecord.discovery_learning.length
        : Array.isArray(resultRecord.discovery_learning)
          ? resultRecord.discovery_learning.length
          : null,
    }));

    return NextResponse.json({
      ok: response.ok && (result as { ok?: boolean }).ok !== false,
      mode: "reels_brain_cron",
      task,
      cadence: "*/5 * * * *",
      policy: "auto until target: bulk while corpus is below target and backlog is small, otherwise analyze",
      learning_plan: learningPlan.ok ? learningPlan.data : null,
      execution_intent: executionIntent,
      adaptive_profile: adaptiveProfile,
      guard: guard ? { ok: guard.ok, can_run_paid_collection: guard.can_run_paid_collection, reason: guard.reason } : null,
      pipeline_progress: pipelineProgress.ok ? pipelineProgress.data : null,
      pipeline_preflight: preflight,
      original_task: auto.task,
      planned_task: nextTick.task || null,
      planned_priority_segment: nextTick.priority_segment || null,
      planned_portfolio_segment: nextTick.portfolio_priority_segment || null,
      target_total: auto.targetTotal,
      max_backlog_before_analyze: auto.maxBacklogBeforeAnalyze,
      backlog: auto.backlog,
      decision: auto.decision,
      endpoint,
      result,
    }, { status: response.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "reels-brain-cron crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
