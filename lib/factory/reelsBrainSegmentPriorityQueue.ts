type SegmentGapRow = {
  niche?: string;
  platform?: string;
  status?: "stable" | "grow_corpus" | "analyze_more" | "build_patterns" | string;
  gap_score?: number;
  gap?: {
    total_videos?: number;
    activation_total_videos?: number;
    analyzed_videos?: number;
    generator_ready_patterns?: number;
    stable_patterns?: number;
  };
  next_action?: string;
};

type SegmentDecisionRow = {
  niche?: string;
  platform?: string;
  decision_grade?: "ship" | "validate" | "prepare" | "research" | string;
  generation_mode?: "decision_ready" | "control_ready" | "brief_only" | "research_only" | string;
  ready_for_generation?: boolean;
  trust_score?: number;
  outcome_status?: string;
  brief?: {
    title?: string;
    hook?: string;
  };
  action?: {
    title?: string;
    decision?: string;
  };
  hypothesis?: {
    title?: string;
  };
  why_now?: string;
  next_step?: string;
};

type SegmentStabilityRow = {
  niche?: string;
  platform?: string;
  evidence_band?: "stable" | "forming" | "thin" | string;
  high_trust_segment?: boolean;
  stability_score?: number;
  blockers?: string[];
};

type SegmentReadinessRow = {
  niche?: string;
  platform?: string;
  total?: number;
  total_backlog?: number;
  dominant_gap?: {
    key?: "media" | "audio" | "transcript" | "analyze" | string;
    count?: number;
    label?: string;
  };
  direct_rate?: number;
  audio_rate?: number;
  transcript_ready_rate?: number;
  analyzed_rate?: number;
};

type SegmentPolicyRow = {
  niche?: string;
  platform?: string;
  policy_mode?: string;
  policy_reason?: string;
  decision_priority_score?: number;
  recommended_upgrade?: Record<string, unknown> | null;
  next_upgrade?: Record<string, unknown> | null;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function keyOf(niche: unknown, platform: unknown) {
  return `${text(niche)}__${text(platform)}`;
}

function policyRank(value: string) {
  if (value === "primary") return 3;
  if (value === "control_only") return 2;
  return 1;
}

function recommendedUpgrade(value: unknown) {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    unlocked_output: text(row.unlocked_output),
    projected_production_state: text(row.projected_production_state),
    projected_trust_gain_score: num(row.projected_trust_gain_score),
    projected_trust_gain_band: text(row.projected_trust_gain_band),
    recommended_loop: text(row.recommended_loop),
    unlocked_next_step: text(row.unlocked_next_step),
  };
}

function normalizeGapAction(status: string) {
  if (status === "grow_corpus") return "collect_segment_batch";
  if (status === "analyze_more") return "analyze_segment_backlog";
  if (status === "build_patterns") return "stabilize_segment_patterns";
  return "watch_segment";
}

function normalizeDecisionAction(grade: string) {
  if (grade === "ship") return "promote_segment_briefs";
  if (grade === "validate") return "validate_segment_briefs";
  if (grade === "prepare") return "prepare_segment_briefs";
  return "watch_segment";
}

function decisionGradeRank(value: string) {
  if (value === "ship") return 4;
  if (value === "validate") return 3;
  if (value === "prepare") return 2;
  return 1;
}

function policyDecisionGrade(value: string) {
  if (value === "primary") return "ship";
  if (value === "control_only") return "validate";
  return "research";
}

function readinessBlocked(row: SegmentReadinessRow | undefined) {
  if (!row) return false;
  const dominantGap = text(row.dominant_gap?.key || "");
  const totalBacklog = num(row.total_backlog);
  if (totalBacklog <= 0) return false;
  if (dominantGap === "media") return num(row.direct_rate) < 55;
  if (dominantGap === "audio") return num(row.audio_rate) < 45;
  if (dominantGap === "transcript") return num(row.transcript_ready_rate) < 40;
  return false;
}

export function buildReelsBrainSegmentPriorityQueue(input: {
  segmentPlan?: {
    focus_segments?: SegmentGapRow[];
  };
  segmentDecisionDeck?: {
    items?: SegmentDecisionRow[];
  };
  segmentStabilityAudit?: {
    items?: SegmentStabilityRow[];
  };
  segmentReadinessWatchlist?: {
    items?: SegmentReadinessRow[];
  };
  generationPolicy?: {
    by_segment?: SegmentPolicyRow[];
  };
  limit?: number;
}) {
  const decisionMap = new Map((input.segmentDecisionDeck?.items || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const stabilityMap = new Map((input.segmentStabilityAudit?.items || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const readinessMap = new Map((input.segmentReadinessWatchlist?.items || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const policyMap = new Map(((input.generationPolicy?.by_segment || []) as SegmentPolicyRow[]).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const gapRows = input.segmentPlan?.focus_segments || [];
  const priorities = gapRows.map((row) => {
    const decision = decisionMap.get(keyOf(row.niche, row.platform)) || {};
    const stability = stabilityMap.get(keyOf(row.niche, row.platform)) || {};
    const readiness = readinessMap.get(keyOf(row.niche, row.platform));
    const policy = policyMap.get(keyOf(row.niche, row.platform)) || {};
    const decisionGrade = text(decision.decision_grade || "research");
    const outcomeStatus = text((decision as { outcome_status?: string }).outcome_status || "no_feedback");
    const policyMode = text(policy.policy_mode || "research_only");
    const policyPriorityScore = num(policy.decision_priority_score);
    const upgrade = recommendedUpgrade((policy.recommended_upgrade || policy.next_upgrade) as Record<string, unknown> | null);
    const gapStatus = text(row.status || "watch");
    const evidenceBand = text(stability.evidence_band || "thin");
    const highTrustSegment = Boolean(stability.high_trust_segment);
    const marketBlocked = outcomeStatus === "weak";
    const readinessGap = text(readiness?.dominant_gap?.key || "analyze");
    const readinessGapCount = num(readiness?.dominant_gap?.count);
    const readinessSoftBlocked = readinessBlocked(readiness);
    const effectiveReadyForGeneration = (
      Boolean(decision.ready_for_generation)
      || policyMode === "primary"
      || policyMode === "control_only"
    ) && !marketBlocked && !readinessSoftBlocked;
    const effectiveDecisionGrade = decisionGradeRank(decisionGrade) >= decisionGradeRank(policyDecisionGrade(policyMode))
      ? decisionGrade
      : policyDecisionGrade(policyMode);
    const globalAction = effectiveReadyForGeneration
      ? normalizeDecisionAction(effectiveDecisionGrade)
      : normalizeGapAction(gapStatus);
    const urgencyBase = Math.round(
      ((effectiveReadyForGeneration) || highTrustSegment ? 55 : 0)
      + Math.min(30, num(decision.trust_score) * 0.22)
      + Math.min(24, num(stability.stability_score) * 0.24)
      + Math.min(35, num(row.gap_score) * 0.35)
      + Math.min(24, num(readiness?.total_backlog) * 0.45)
      + (gapStatus === "analyze_more" ? 10 : 0)
      + (gapStatus === "grow_corpus" ? 8 : 0)
      + (evidenceBand === "stable" ? 14 : evidenceBand === "forming" ? 6 : 0)
      + (effectiveDecisionGrade === "ship" ? 18 : effectiveDecisionGrade === "validate" ? 10 : effectiveDecisionGrade === "prepare" ? 4 : 0)
      + (policyRank(policyMode) === 3 ? 20 : policyRank(policyMode) === 2 ? 10 : 0)
      + Math.min(22, policyPriorityScore * 0.2)
      + Math.min(18, upgrade.projected_trust_gain_score * 0.55)
      + (readinessGap === "audio" || readinessGap === "transcript" ? 12 : readinessGap === "media" ? 8 : 0)
      - (marketBlocked ? 36 : 0)
      - (readinessSoftBlocked && Boolean(decision.ready_for_generation) ? 18 : 0)
    );
    const urgency = Math.max(0, Math.min(100, urgencyBase));
    const decisionPriorityScore = Math.max(urgency, policyPriorityScore, upgrade.projected_trust_gain_score > 0 ? Math.min(100, urgency + Math.round(upgrade.projected_trust_gain_score * 0.4)) : urgency);
    return {
      niche: text(row.niche),
      platform: text(row.platform),
      label: `${text(row.niche)} × ${text(row.platform)}`,
      action: globalAction,
      urgency_score: urgency,
      decision_priority_score: decisionPriorityScore,
      gap_status: gapStatus,
      decision_grade: effectiveDecisionGrade,
      generation_mode: text(decision.generation_mode || "research_only"),
      policy_mode: policyMode,
      policy_reason: text(policy.policy_reason),
      ready_for_generation: effectiveReadyForGeneration,
      outcome_status: outcomeStatus,
      evidence_band: evidenceBand,
      high_trust_segment: highTrustSegment,
      stability_score: num(stability.stability_score),
      gap_score: num(row.gap_score),
      trust_score: num(decision.trust_score),
      recommended_upgrade: upgrade,
      readiness_blocked: readinessSoftBlocked,
      readiness_total_backlog: num(readiness?.total_backlog),
      readiness_direct_rate: num(readiness?.direct_rate),
      readiness_audio_rate: num(readiness?.audio_rate),
      readiness_transcript_ready_rate: num(readiness?.transcript_ready_rate),
      readiness_analyzed_rate: num(readiness?.analyzed_rate),
      readiness_dominant_gap: readinessGap,
      readiness_dominant_gap_count: readinessGapCount,
      brief_title: text(decision.brief?.title),
      brief_hook: text(decision.brief?.hook),
      action_title: text(decision.action?.title),
      action_decision: text(decision.action?.decision),
      hypothesis_title: text(decision.hypothesis?.title),
      next_action: text(row.next_action || decision.next_step),
      why_now: text(decision.why_now),
      blockers: Array.isArray(stability.blockers) ? stability.blockers.map((item) => text(item)).filter(Boolean).slice(0, 4) : [],
      gaps: {
        total_videos: num(row.gap?.total_videos),
        activation_total_videos: num(row.gap?.activation_total_videos),
        analyzed_videos: num(row.gap?.analyzed_videos),
        generator_ready_patterns: num(row.gap?.generator_ready_patterns),
        stable_patterns: num(row.gap?.stable_patterns),
      },
    };
  }).sort((a, b) =>
    b.decision_priority_score - a.decision_priority_score
    || b.urgency_score - a.urgency_score
    || Number(b.ready_for_generation) - Number(a.ready_for_generation)
    || num(b.recommended_upgrade.projected_trust_gain_score) - num(a.recommended_upgrade.projected_trust_gain_score)
    || b.gap_score - a.gap_score
    || b.trust_score - a.trust_score
    || a.niche.localeCompare(b.niche)
    || a.platform.localeCompare(b.platform),
  );

  return {
    summary: {
      total: priorities.length,
      collect_segment_batch: priorities.filter((item) => item.action === "collect_segment_batch").length,
      analyze_segment_backlog: priorities.filter((item) => item.action === "analyze_segment_backlog").length,
      stabilize_segment_patterns: priorities.filter((item) => item.action === "stabilize_segment_patterns").length,
      promote_segment_briefs: priorities.filter((item) => item.action === "promote_segment_briefs").length,
      validate_segment_briefs: priorities.filter((item) => item.action === "validate_segment_briefs").length,
      ready_for_generation: priorities.filter((item) => item.ready_for_generation).length,
      readiness_blocked: priorities.filter((item) => item.readiness_blocked).length,
      high_trust_segments: priorities.filter((item) => item.high_trust_segment).length,
      stable_segments: priorities.filter((item) => item.evidence_band === "stable").length,
      forming_segments: priorities.filter((item) => item.evidence_band === "forming").length,
    },
    items: priorities.slice(0, Math.max(4, input.limit || 8)),
  };
}
