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

console.log("reelsBrainLearningPlan: passed");
