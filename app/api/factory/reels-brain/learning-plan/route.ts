import { NextRequest, NextResponse } from "next/server";
import { internalFetch } from "@/lib/internalFetch";
import {
  REELS_BRAIN_CORPUS_TARGET_TOTAL,
  corpusExecutionPlan,
  corpusProgress,
  corpusStage,
  corpusTargetByNiche,
  corpusTargetByPlatform,
} from "@/lib/factory/reelsBrainCorpusTargets";
import { buildReelsBrainNextTick } from "@/lib/factory/reelsBrainLearningPlan";
import { buildReelsBrainSegmentGapPlanner } from "@/lib/factory/reelsBrainSegmentGapPlanner";
import { buildReelsBrainSegmentPriorityQueue } from "@/lib/factory/reelsBrainSegmentPriorityQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

type JsonRecord = Record<string, any>;

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitList(value: unknown, fallback: string[]) {
  const rows = String(value || "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
  return Array.from(new Set(rows.length ? rows : fallback)).slice(0, 20);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function firstPositive(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

async function readInternal(req: NextRequest, path: string, params: Record<string, string>) {
  const url = new URL(path, req.nextUrl.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await internalFetch(url);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || body?.warning || response.statusText);
  return body as JsonRecord;
}

function rowMap(source: unknown, key: string) {
  const rows = source && typeof source === "object" ? source as Record<string, JsonRecord> : {};
  return Object.entries(rows).map(([id, row]) => ({ [key]: id, ...row }));
}

function learningVelocity(timeline: JsonRecord[]) {
  const recent = timeline.slice(-8);
  const inserted = recent.reduce((sum, row) => sum + num(row.inserted), 0);
  const analyzed = recent.reduce((sum, row) => sum + num(row.analyzed), 0);
  const runs = Math.max(1, recent.length);
  return {
    sample_runs: recent.length,
    inserted_per_tick: Math.round(inserted / runs),
    analyzed_per_tick: Math.round(analyzed / runs),
  };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const target = clamp(num(sp.get("target")) || REELS_BRAIN_CORPUS_TARGET_TOTAL, 300, 250_000);
    const backlogLimit = clamp(num(sp.get("max_backlog_before_analyze")) || 180, 20, 2_000);
    const niches = splitList(sp.get("niches"), ["ru_toys", "ru_clothing", "ru_cosmetics"]);
    const platforms = splitList(sp.get("platforms"), ["tiktok", "instagram", "youtube"]);

    const [learning, corpus, autopilot, progressBody] = await Promise.all([
      readInternal(req, "/api/factory/reels-brain/learning-economics", { niches: niches.join(","), limit: sp.get("limit") || "80" }),
      readInternal(req, "/api/factory/reels-brain/corpus", { limit: "200", min_score: "0" }),
      readInternal(req, "/api/factory/reels-brain/autopilot-actions", { niches: niches.join(","), limit: sp.get("limit") || "80" }),
      readInternal(req, "/api/factory/reels-brain/progress", { niches: niches.join(",") }),
    ]);

    const totals = learning.totals || {};
    const audit = learning.corpus_audit || {};
    const totalVideos = Math.max(num(totals.total_videos), num(corpus.total), num(audit.sampled_rows));
    const analyzedVideos = Math.max(num(totals.analyzed_videos), num(corpus.summary?.analyzed));
    const backlog = Math.max(0, totalVideos - analyzedVideos);
    const progress = corpusProgress({ current: totalVideos, target });
    const stage = corpusStage(totalVideos);
    const platformTargets = corpusTargetByPlatform(target);
    const nicheTargets = corpusTargetByNiche(niches, target);
    const platformRows = rowMap(audit.by_platform, "platform")
      .filter((row) => platforms.includes(String(row.platform)))
      .map((row) => ({
        platform: row.platform as "tiktok" | "instagram" | "youtube",
        current: num(row.total),
        target: num(platformTargets[row.platform as keyof typeof platformTargets]),
      }));
    const nicheRows = rowMap(audit.by_niche, "niche")
      .filter((row) => niches.includes(String(row.niche)))
      .map((row) => ({ niche: String(row.niche), current: num(row.total), target: num(nicheTargets[String(row.niche)]) }));
    const executionPlan = corpusExecutionPlan({
      currentTotal: totalVideos,
      targetTotal: target,
      niches: nicheRows.length ? nicheRows : niches.map((niche) => ({ niche, current: 0, target: num(nicheTargets[niche]) })),
      platforms: platformRows.length ? platformRows : (Object.entries(platformTargets) as Array<["tiktok" | "instagram" | "youtube", number]>)
        .filter(([platform]) => platforms.includes(platform))
        .map(([platform, platformTarget]) => ({ platform, current: 0, target: platformTarget })),
      horizonDays: num(sp.get("horizon_days")) || 30,
    });
    const segmentPlan = buildReelsBrainSegmentGapPlanner({
      targetTotal: target,
      niches: Array.isArray(learning.niches) ? learning.niches : [],
      patternAtlas: learning.pattern_atlas || null,
      platforms: platforms.filter((platform): platform is "tiktok" | "instagram" | "youtube" =>
        platform === "tiktok" || platform === "instagram" || platform === "youtube",
      ),
      limit: 8,
    });
    const segmentPriorityQueue = buildReelsBrainSegmentPriorityQueue({
      segmentPlan,
      segmentDecisionDeck: learning.segment_decision_deck || null,
      segmentStabilityAudit: learning.segment_stability_audit || null,
      segmentReadinessWatchlist: {
        items: Array.isArray(progressBody.segment_watchlist) ? progressBody.segment_watchlist : [],
      },
      limit: 8,
    });
    const prioritySegment = ((segmentPriorityQueue.items || [])[0] || null) as JsonRecord | null;
    const stabilitySummary = (learning.segment_stability_audit?.summary || {}) as JsonRecord;
    const portfolioReadiness = (learning.portfolio_readiness || {}) as JsonRecord;
    const portfolioSummary = (portfolioReadiness.summary || {}) as JsonRecord;
    const exactSegmentQueue = (learning.exact_segment_queue || {}) as JsonRecord;
    const exactQueueItems = Array.isArray(exactSegmentQueue.items) ? exactSegmentQueue.items as JsonRecord[] : [];
    const briefCoverageAudit = (learning.brief_coverage_audit || {}) as JsonRecord;
    const briefCoverageGapQueue = Array.isArray(briefCoverageAudit.gap_queue) ? briefCoverageAudit.gap_queue as JsonRecord[] : [];
    const shipReadyQueue = (learning.ship_ready_queue || {}) as JsonRecord;
    const shipReadyItems = Array.isArray(shipReadyQueue.items) ? shipReadyQueue.items as JsonRecord[] : [];
    const topShipCandidates = Array.isArray(shipReadyQueue.top_ship_candidates) ? shipReadyQueue.top_ship_candidates as JsonRecord[] : [];

    const costGovernor = autopilot.cost_governor || learning.cost_governor || {};
    const autopilotActions = autopilot.autopilot_actions || learning.autopilot_actions || {};
    const canRunPaidCollection = Boolean(autopilotActions.can_run_paid_collection ?? true)
      && !["pause_or_review", "paused", "blocked"].includes(String(costGovernor.status || ""));
    const velocity = learningVelocity((learning.timeline || []) as JsonRecord[]);
    const relevantSpeed = firstPositive(velocity.inserted_per_tick, velocity.analyzed_per_tick, 25);
    const etaTicksToTarget = progress.gap > 0 ? Math.ceil(progress.gap / Math.max(1, relevantSpeed)) : 0;
    const etaTicksToAnalyzed = backlog > 0 ? Math.ceil(backlog / Math.max(1, firstPositive(velocity.analyzed_per_tick, 40))) : 0;
    const preferredPrioritySegment = (exactQueueItems[0] as JsonRecord | undefined)?.exact_proof_missing
      ? ((segmentPriorityQueue.items || [])[0] || exactQueueItems[0] || null) as JsonRecord | null
      : prioritySegment;
    const nextTick = buildReelsBrainNextTick({
      target,
      totalVideos,
      analyzedVideos,
      backlogLimit,
      canRunPaidCollection,
      guardStatus: String(costGovernor.status || ""),
      prioritySegment: preferredPrioritySegment,
      portfolioReadiness,
      generationPolicy: (learning.generation_policy || null) as JsonRecord | null,
      segmentPriorityQueue,
      outcomeMemory: (learning.outcome_memory_brain || null) as JsonRecord | null,
      exactSegmentQueue,
      briefCoverageAudit,
      shipReadyQueue,
      learningEconomics: {
        pattern_gain_cost_trend: totals.pattern_gain_cost_trend,
        pattern_gain_proxy_total: totals.pattern_gain_proxy_total,
        high_trust_gain_proxy_total: totals.high_trust_gain_proxy_total,
        cost_units_per_pattern_gain_recent: totals.cost_units_per_pattern_gain_recent,
        weak_pattern_gain: costGovernor.weak_pattern_gain,
      },
    });

    return NextResponse.json({
      ok: true,
      learning_plan: {
        mission: "standalone_reels_brain_training",
        target_videos: target,
        niches,
        platforms,
        progress,
        stage,
        backlog: {
          total: backlog,
          limit_before_paid_collection: backlogLimit,
          status: backlog >= backlogLimit ? "analyze_first" : "healthy",
        },
        next_tick: nextTick,
        portfolio_priority_segment: nextTick.portfolio_priority_segment || null,
        execution_plan: executionPlan,
        segment_plan: segmentPlan,
        segment_priority_queue: segmentPriorityQueue,
        exact_segment_queue: {
          exact_proof_coverage_pct: num((exactSegmentQueue.summary as JsonRecord | undefined)?.exact_proof_coverage_pct),
          exact_gap_segments: num((exactSegmentQueue.summary as JsonRecord | undefined)?.exact_gap_segments),
          borrowed_brief_segments: num((exactSegmentQueue.summary as JsonRecord | undefined)?.borrowed_brief_segments),
          weak_exact_outcome_segments: num((exactSegmentQueue.summary as JsonRecord | undefined)?.weak_exact_outcome_segments),
          avg_expected_trust_gain: num((exactSegmentQueue.summary as JsonRecord | undefined)?.avg_expected_trust_gain),
          avg_eta_ticks: num((exactSegmentQueue.summary as JsonRecord | undefined)?.avg_eta_ticks),
          avg_data_readiness_score: num((exactSegmentQueue.summary as JsonRecord | undefined)?.avg_data_readiness_score),
          provider_recommendations: Array.isArray((exactSegmentQueue.summary as JsonRecord | undefined)?.provider_recommendations)
            ? ((exactSegmentQueue.summary as JsonRecord | undefined)?.provider_recommendations as unknown[])
                .map((item) => String(item || "").trim())
                .filter(Boolean)
                .slice(0, 6)
            : [],
          items: exactQueueItems.slice(0, 6),
        },
        brief_coverage_audit: {
          usable_exact_ready_briefs: num((briefCoverageAudit.summary as JsonRecord | undefined)?.usable_exact_ready_briefs),
          exact_ready_briefs: num((briefCoverageAudit.summary as JsonRecord | undefined)?.exact_ready_briefs),
          ship_lane_briefs: num((briefCoverageAudit.summary as JsonRecord | undefined)?.ship_lane_briefs),
          validate_lane_briefs: num((briefCoverageAudit.summary as JsonRecord | undefined)?.validate_lane_briefs),
          usable_exact_ready_pct: num((briefCoverageAudit.summary as JsonRecord | undefined)?.usable_exact_ready_pct),
          blocked_or_incomplete_segments: num((briefCoverageAudit.summary as JsonRecord | undefined)?.blocked_or_incomplete_segments),
          items: briefCoverageGapQueue.slice(0, 6),
        },
        ship_ready_queue: {
          ship_candidates: num((shipReadyQueue.summary as JsonRecord | undefined)?.ship_candidates),
          validate_candidates: num((shipReadyQueue.summary as JsonRecord | undefined)?.validate_candidates),
          exact_ready_gaps: num((shipReadyQueue.summary as JsonRecord | undefined)?.exact_ready_gaps),
          avg_ship_readiness_score: num((shipReadyQueue.summary as JsonRecord | undefined)?.avg_ship_readiness_score),
          top_ship_ready_pct: num((shipReadyQueue.summary as JsonRecord | undefined)?.top_ship_ready_pct),
          top_ship_candidates: topShipCandidates.slice(0, 3),
          items: shipReadyItems.slice(0, 6),
        },
        segment_stability: {
          stable: num(stabilitySummary.stable),
          forming: num(stabilitySummary.forming),
          thin: num(stabilitySummary.thin),
          high_trust_segments: num(stabilitySummary.high_trust_segments),
          decision_ready_segments: num(stabilitySummary.decision_ready),
        },
        portfolio_readiness: {
          expected_segments: num(portfolioSummary.expected_segments),
          stable_segments: num(portfolioSummary.stable_segments),
          forming_segments: num(portfolioSummary.forming_segments),
          thin_segments: num(portfolioSummary.thin_segments),
          missing_segments: num(portfolioSummary.missing_segments),
          high_trust_coverage_pct: num(portfolioSummary.high_trust_coverage_pct),
          publishable_exact_segments: num(portfolioSummary.publishable_exact_segments),
          publishable_exact_coverage_pct: num(portfolioSummary.publishable_exact_coverage_pct),
          known_coverage_pct: num(portfolioSummary.known_coverage_pct),
          verdict: String(portfolioSummary.verdict || "still_building"),
        },
        feedback_coverage: {
          coverage_rate: num(learning.outcome_memory_brain?.pattern_memory?.coverage_rate),
          high_confidence_no_feedback: num(learning.outcome_memory_brain?.pattern_memory?.coverage_gaps?.high_confidence_no_feedback),
          medium_confidence_no_feedback: num(learning.outcome_memory_brain?.pattern_memory?.coverage_gaps?.medium_confidence_no_feedback),
          total_no_feedback_queue: num(learning.outcome_memory_brain?.pattern_memory?.coverage_gaps?.total_no_feedback_queue),
          top_unvalidated_patterns: Array.isArray(learning.outcome_memory_brain?.pattern_memory?.no_feedback_queue)
            ? (learning.outcome_memory_brain.pattern_memory.no_feedback_queue as JsonRecord[]).slice(0, 5)
            : [],
        },
        eta: {
          ticks_to_target: etaTicksToTarget,
          ticks_to_clear_backlog: etaTicksToAnalyzed,
          inserted_per_tick: velocity.inserted_per_tick,
          analyzed_per_tick: velocity.analyzed_per_tick,
          sample_runs: velocity.sample_runs,
        },
        guard: {
          can_run_paid_collection: canRunPaidCollection,
          status: costGovernor.status || "watch",
          today_spend_usd: num(costGovernor.today_spend_usd),
          max_daily_spend_usd: num(costGovernor.max_daily_spend_usd),
          current_useful_video_usd: num(costGovernor.current_useful_video_usd),
          max_useful_video_usd: num(costGovernor.max_useful_video_usd),
        },
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "learning-plan reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
