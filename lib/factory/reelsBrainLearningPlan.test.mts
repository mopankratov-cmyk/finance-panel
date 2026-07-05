import assert from "node:assert/strict";
import { buildReelsBrainNextTick, pickPortfolioFocusSegment } from "./reelsBrainLearningPlan";

const focus = pickPortfolioFocusSegment({
  missing_segments: [
    { niche: "ru_toys", platform: "instagram", label: "ru_toys × instagram", evidence_band: "forming", stability_score: 52, missing: false },
    { niche: "ru_cosmetics", platform: "youtube", label: "ru_cosmetics × youtube", evidence_band: "missing", stability_score: 0, missing: true },
    { niche: "ru_clothing", platform: "tiktok", label: "ru_clothing × tiktok", evidence_band: "thin", stability_score: 18, missing: false },
  ],
});

assert.equal(focus?.niche, "ru_cosmetics");
assert.equal(focus?.platform, "youtube");

const nextTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3150,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_toys",
    platform: "tiktok",
    label: "ru_toys × tiktok",
    action: "collect_segment_batch",
  },
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 42,
      verdict: "still_building",
    },
    missing_segments: [
      { niche: "ru_cosmetics", platform: "youtube", label: "ru_cosmetics × youtube", evidence_band: "missing", stability_score: 0, missing: true },
    ],
  },
});

assert.equal(nextTick.task, "collect_portfolio_gaps");
assert.equal((nextTick.params as Record<string, unknown>).niche, "ru_cosmetics");
assert.equal((nextTick.params as Record<string, unknown>).platform, "youtube");
assert.equal(nextTick.portfolio_priority_segment?.label, "ru_cosmetics × youtube");
assert.match(nextTick.reason, /ru_cosmetics × youtube/);

const decisionSupportTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3150,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_toys",
    platform: "tiktok",
    label: "ru_toys × tiktok",
    action: "promote_segment_briefs",
    ready_for_generation: true,
  },
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 42,
      verdict: "still_building",
    },
    missing_segments: [
      { niche: "ru_cosmetics", platform: "youtube", label: "ru_cosmetics × youtube", evidence_band: "missing", stability_score: 0, missing: true },
    ],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        label: "ru_toys × tiktok",
        policy_mode: "control_only",
        trust_band: "medium",
        evidence_band: "forming",
        readiness_score: 72,
        policy_reason: "segment already has a control-ready package",
      },
    ],
  },
});

assert.equal(decisionSupportTick.task, "collect_support_for_decision_segment");
assert.equal((decisionSupportTick.params as Record<string, unknown>).niche, "ru_toys");
assert.equal((decisionSupportTick.params as Record<string, unknown>).platform, "tiktok");
assert.equal((decisionSupportTick.generation_policy as Record<string, unknown>)?.policy_mode, "control_only");
assert.match(decisionSupportTick.reason, /Policy control_only/);

const policyDrivenTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3150,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_clothing",
    platform: "instagram",
    label: "ru_clothing × instagram",
    action: "watch_segment",
  },
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 84,
      verdict: "forming",
    },
    missing_segments: [],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        label: "ru_clothing × instagram",
        policy_mode: "primary",
        trust_band: "high",
        evidence_band: "stable",
        readiness_score: 91,
        policy_reason: "segment is already primary-ready",
      },
    ],
  },
});

assert.equal(policyDrivenTick.task, "collect_support_for_decision_segment");
assert.match(policyDrivenTick.reason, /primary-ready/);

const publishableExactCoverageTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3150,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_clothing",
    platform: "instagram",
    label: "ru_clothing × instagram",
    action: "watch_segment",
  },
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 84,
      publishable_exact_coverage_pct: 33,
      verdict: "high_trust_but_exact_gaps",
    },
    missing_segments: [],
    publishable_exact_gaps: [
      {
        niche: "ru_cosmetics",
        platform: "instagram",
        label: "ru_cosmetics × instagram",
        evidence_band: "forming",
        stability_score: 48,
        missing: false,
        high_trust_segment: false,
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        label: "ru_toys × youtube",
        evidence_band: "stable",
        stability_score: 79,
        missing: false,
        high_trust_segment: true,
      },
    ],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_toys",
        platform: "youtube",
        label: "ru_toys × youtube",
        policy_mode: "primary",
        trust_band: "high",
        evidence_band: "stable",
        readiness_score: 90,
        policy_reason: "segment is one step away from publishable exact",
      },
    ],
  },
  segmentPriorityQueue: {
    items: [
      {
        niche: "ru_toys",
        platform: "youtube",
        urgency_score: 92,
        readiness_analyzed_rate: 88,
      },
      {
        niche: "ru_cosmetics",
        platform: "instagram",
        urgency_score: 44,
        readiness_analyzed_rate: 39,
      },
    ],
  },
});

assert.equal(publishableExactCoverageTick.task, "collect_portfolio_gaps");
assert.equal((publishableExactCoverageTick.params as Record<string, unknown>).niche, "ru_toys");
assert.equal((publishableExactCoverageTick.params as Record<string, unknown>).platform, "youtube");
assert.match(publishableExactCoverageTick.label, /publishable exact/i);
assert.match(publishableExactCoverageTick.reason, /publishable exact coverage/i);

const weakOutcomeTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3150,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_clothing",
    platform: "instagram",
    label: "ru_clothing × instagram",
    action: "promote_segment_briefs",
    ready_for_generation: true,
  },
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 42,
      verdict: "still_building",
    },
    missing_segments: [
      { niche: "ru_cosmetics", platform: "youtube", label: "ru_cosmetics × youtube", evidence_band: "missing", stability_score: 0, missing: true },
    ],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        label: "ru_clothing × instagram",
        policy_mode: "research_only",
        outcome_status: "weak",
        trust_band: "medium",
        evidence_band: "forming",
        readiness_score: 74,
        policy_reason: "market outcome is weak",
      },
    ],
  },
});

assert.equal(weakOutcomeTick.task, "collect_portfolio_gaps");
assert.equal((weakOutcomeTick.params as Record<string, unknown>).niche, "ru_cosmetics");
assert.match(weakOutcomeTick.reason, /weak outcome/);

const expensivePatternGainTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3110,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_toys",
    platform: "tiktok",
    label: "ru_toys × tiktok",
    action: "collect_segment_batch",
  },
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 58,
      verdict: "still_building",
    },
    missing_segments: [],
  },
  learningEconomics: {
    pattern_gain_cost_trend: "more_expensive",
    weak_pattern_gain: true,
    pattern_gain_proxy_total: 12,
    high_trust_gain_proxy_total: 4,
    cost_units_per_pattern_gain_recent: 18,
  },
});

assert.equal(expensivePatternGainTick.task, "analyze_backlog");
assert.equal((expensivePatternGainTick.params as Record<string, unknown>).build_patterns, "true");
assert.match(expensivePatternGainTick.reason, /economics уже ухудшилась/);

const readinessBlockedTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3150,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_toys",
    platform: "youtube",
    label: "ru_toys × youtube",
    action: "promote_segment_briefs",
    ready_for_generation: false,
    readiness_blocked: true,
    readiness_dominant_gap: "audio",
    readiness_total_backlog: 33,
  },
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 42,
      verdict: "still_building",
    },
    missing_segments: [
      { niche: "ru_cosmetics", platform: "youtube", label: "ru_cosmetics × youtube", evidence_band: "missing", stability_score: 0, missing: true },
    ],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_toys",
        platform: "youtube",
        label: "ru_toys × youtube",
        policy_mode: "primary",
        trust_band: "high",
        evidence_band: "stable",
        readiness_score: 89,
        policy_reason: "segment is trust-strong but asset layer is still weak",
      },
    ],
  },
});

assert.equal(readinessBlockedTick.task, "collect_portfolio_gaps");
assert.equal((readinessBlockedTick.params as Record<string, unknown>).niche, "ru_cosmetics");
assert.match(readinessBlockedTick.label, /ещё сырой/);
assert.match(readinessBlockedTick.reason, /не дозрел по learning-layer/);

const feedbackCoverageTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 9100,
  analyzedVideos: 9050,
  backlogLimit: 180,
  canRunPaidCollection: true,
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 78,
      verdict: "forming",
    },
    missing_segments: [],
  },
  outcomeMemory: {
    pattern_memory: {
      coverage_rate: 54,
      coverage_gaps: {
        high_confidence_no_feedback: 3,
        medium_confidence_no_feedback: 1,
        total_no_feedback_queue: 4,
      },
      no_feedback_queue: [
        { pattern_id: "p1" },
        { pattern_id: "p2" },
        { pattern_id: "p3" },
      ],
    },
  },
});

assert.equal(feedbackCoverageTick.task, "improve_feedback_coverage");
assert.equal((feedbackCoverageTick.params as Record<string, unknown>).focus, "feedback_coverage");
assert.equal((feedbackCoverageTick.params as Record<string, unknown>).pattern_ids, "p1,p2,p3");
assert.match(feedbackCoverageTick.reason, /high-confidence паттернов всё ещё без market proof/);

const exactProofTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3150,
  backlogLimit: 180,
  canRunPaidCollection: true,
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 42,
      verdict: "still_building",
    },
    missing_segments: [
      { niche: "ru_cosmetics", platform: "youtube", label: "ru_cosmetics × youtube", evidence_band: "missing", stability_score: 0, missing: true },
    ],
  },
  exactSegmentQueue: {
    items: [
      {
        niche: "ru_toys",
        platform: "instagram",
        label: "ru_toys × instagram",
        evidence_band: "forming",
        stability_score: 61,
        exact_proof_missing: true,
        source_provider: "bright_instagram",
        source_discovery_mode: "close_exact_proof",
        source_provider_reason: "instagram exact proof needs pinned provider",
      },
    ],
  },
});

assert.equal(exactProofTick.task, "collect_portfolio_gaps");
assert.equal((exactProofTick.params as Record<string, unknown>).niche, "ru_toys");
assert.equal((exactProofTick.params as Record<string, unknown>).platform, "instagram");

const exactProofDecisionSupportTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3150,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_toys",
    platform: "instagram",
    label: "ru_toys × instagram",
    action: "promote_segment_briefs",
    ready_for_generation: true,
  },
  portfolioReadiness: {
    summary: {
      high_trust_coverage_pct: 56,
      verdict: "forming",
    },
    missing_segments: [
      { niche: "ru_cosmetics", platform: "youtube", label: "ru_cosmetics × youtube", evidence_band: "missing", stability_score: 0, missing: true },
    ],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_toys",
        platform: "instagram",
        label: "ru_toys × instagram",
        policy_mode: "primary",
        trust_band: "high",
        evidence_band: "forming",
        readiness_score: 82,
        policy_reason: "segment is strong, but exact-proof is still open",
      },
    ],
  },
  exactSegmentQueue: {
    items: [
      {
        niche: "ru_toys",
        platform: "instagram",
        label: "ru_toys × instagram",
        evidence_band: "forming",
        stability_score: 61,
        exact_proof_missing: true,
        source_provider: "bright_instagram",
        source_discovery_mode: "close_exact_proof",
        source_provider_reason: "instagram exact proof needs pinned provider",
      },
    ],
  },
});

assert.equal(exactProofDecisionSupportTick.task, "collect_support_for_decision_segment");
assert.equal((exactProofDecisionSupportTick.params as Record<string, unknown>).niche, "ru_toys");
assert.equal((exactProofDecisionSupportTick.params as Record<string, unknown>).platform, "instagram");
assert.equal((exactProofDecisionSupportTick.params as Record<string, unknown>).focus, "exact_segment_proof");
assert.equal((exactProofDecisionSupportTick.params as Record<string, unknown>).preferred_provider, "bright_instagram");
assert.equal((exactProofDecisionSupportTick.params as Record<string, unknown>).source_discovery_mode, "close_exact_proof");
assert.match(exactProofDecisionSupportTick.label, /exact proof/i);
assert.match(exactProofDecisionSupportTick.reason, /exact-segment proof/i);

const briefBundleCompletionTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3140,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_toys",
    platform: "tiktok",
    label: "ru_toys × tiktok",
    action: "promote_segment_briefs",
    ready_for_generation: true,
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        label: "ru_toys × tiktok",
        policy_mode: "primary",
        trust_band: "high",
        evidence_band: "stable",
        readiness_score: 91,
        policy_reason: "segment is ready on trust but export pack is still incomplete",
      },
    ],
  },
  exactSegmentQueue: {
    items: [],
  },
  briefCoverageAudit: {
    summary: {
      blocked_or_incomplete_segments: 2,
    },
    gap_queue: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        label: "ru_toys × tiktok",
        lane: "ship",
        proof_quality: "exact_segment",
        missing_fields: ["structure"],
        missing_field_families: ["structure"],
        blocked_reasons: [],
        next_step: "Fill structure in brief bundle",
      },
    ],
  },
  briefGapProgress: {
    top_candidates: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        label: "ru_toys × tiktok",
        lane: "ship",
        missing_fields: ["visual recipe"],
        missing_field_families: ["visual"],
        unlocked_output: "publishable_visual_brief",
        projected_trust_gain_score: 33,
        projected_trust_gain_band: "high",
        projected_production_state: "publishable_exact",
      },
    ],
  },
});

assert.equal(briefBundleCompletionTick.task, "analyze_backlog");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).focus, "brief_bundle_completion");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).build_patterns, "true");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).niche, "ru_toys");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).platform, "tiktok");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).field_focus, "visual recipe");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).family_focus, "visual");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).projected_trust_gain_score, "33");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).projected_trust_gain_band, "high");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).unlocked_output, "publishable_visual_brief");
assert.equal((briefBundleCompletionTick.params as Record<string, unknown>).projected_production_state, "publishable_exact");
assert.match(briefBundleCompletionTick.label, /usable brief/i);
assert.match(briefBundleCompletionTick.reason, /usable creative export/i);
assert.match(briefBundleCompletionTick.reason, /Главный пробел сейчас: visual recipe/);
assert.match(briefBundleCompletionTick.reason, /Что откроется после фикса: publishable_visual_brief/);
assert.match(briefBundleCompletionTick.reason, /Ожидаемый trust delta: \+\d+ \(high\)/);
assert.equal((briefBundleCompletionTick.brief_gap_progress_focus as Record<string, unknown>)?.label, "ru_toys × tiktok");

const shipReadyBundleCompletionTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3140,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_clothing",
    platform: "instagram",
    label: "ru_clothing × instagram",
    action: "promote_segment_briefs",
    ready_for_generation: true,
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        label: "ru_clothing × instagram",
        policy_mode: "primary",
        trust_band: "high",
        evidence_band: "stable",
        readiness_score: 94,
        policy_reason: "segment is one gap away from a publishable exact brief",
      },
    ],
  },
  exactSegmentQueue: {
    items: [],
  },
  shipReadyQueue: {
    summary: {
      ship_candidates: 3,
    },
    top_ship_candidates: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        label: "ru_clothing × instagram",
        lane: "ship",
        ship_readiness_score: 92,
        missing_fields: ["visual_recipe"],
        missing_field_families: ["visual"],
      },
    ],
  },
  briefGapProgress: {
    top_candidates: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        label: "ru_clothing × instagram",
        lane: "ship",
        missing_fields: ["visual_recipe"],
        missing_field_families: ["visual"],
        unlocked_output: "publishable_visual_brief",
        projected_trust_gain_score: 31,
        projected_trust_gain_band: "high",
        projected_production_state: "publishable_exact",
      },
    ],
  },
});

assert.equal(shipReadyBundleCompletionTick.task, "analyze_backlog");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).focus, "ship_ready_bundle_completion");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).build_patterns, "true");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).niche, "ru_clothing");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).platform, "instagram");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).field_focus, "visual_recipe");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).family_focus, "visual");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).projected_trust_gain_score, "31");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).projected_trust_gain_band, "high");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).unlocked_output, "publishable_visual_brief");
assert.equal((shipReadyBundleCompletionTick.params as Record<string, unknown>).projected_production_state, "publishable_exact");
assert.match(shipReadyBundleCompletionTick.label, /ship-ready bundle/i);
assert.match(shipReadyBundleCompletionTick.reason, /publishable exact brief/i);
assert.match(shipReadyBundleCompletionTick.reason, /Главный пробел сейчас: visual_recipe/);
assert.match(shipReadyBundleCompletionTick.reason, /Что откроется после фикса:/);

const upgradeDrivenAnalyzeTick = buildReelsBrainNextTick({
  target: 10000,
  totalVideos: 3200,
  analyzedVideos: 3140,
  backlogLimit: 180,
  canRunPaidCollection: true,
  prioritySegment: {
    niche: "ru_toys",
    platform: "tiktok",
    label: "ru_toys × tiktok",
    action: "watch_segment",
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        label: "ru_clothing × instagram",
        policy_mode: "primary",
        trust_band: "high",
        evidence_band: "stable",
        readiness_score: 95,
        policy_reason: "segment has the highest publishable exact payoff now",
      },
    ],
  },
  briefCoverageAudit: {
    summary: {
      blocked_or_incomplete_segments: 1,
    },
    gap_queue: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        label: "ru_clothing × instagram",
        lane: "ship",
        proof_quality: "exact_segment",
        missing_fields: ["visual_recipe"],
        missing_field_families: ["visual"],
        blocked_reasons: [],
      },
    ],
  },
  briefGapProgress: {
    top_candidates: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        label: "ru_clothing × instagram",
        lane: "ship",
        proof_quality: "exact_segment",
        missing_fields: ["visual_recipe"],
        missing_field_families: ["visual"],
        unlocked_output: "publishable_visual_brief",
        projected_trust_gain_score: 34,
        projected_trust_gain_band: "high",
        projected_production_state: "publishable_exact",
      },
    ],
  },
});

assert.equal(upgradeDrivenAnalyzeTick.task, "analyze_backlog");
assert.equal((upgradeDrivenAnalyzeTick.params as Record<string, unknown>).niche, "ru_clothing");
assert.equal((upgradeDrivenAnalyzeTick.params as Record<string, unknown>).platform, "instagram");
assert.equal((upgradeDrivenAnalyzeTick.priority_segment as Record<string, unknown>)?.label, "ru_clothing × instagram");
assert.match(upgradeDrivenAnalyzeTick.label, /ru_clothing × instagram/);
assert.match(upgradeDrivenAnalyzeTick.reason, /usable creative export/i);

console.log("reelsBrainLearningPlan: passed");
