import assert from "node:assert/strict";
import { buildReelsBrainBriefGapProgress } from "./reelsBrainBriefGapProgress";

const result = buildReelsBrainBriefGapProgress({
  briefCoverageAudit: {
    gap_queue: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        label: "ru_toys × tiktok",
        lane: "ship",
        proof_quality: "exact_segment",
        readiness_score: 92,
        missing_fields: ["visual recipe"],
        missing_field_families: ["visual"],
        blocked_reasons: [],
        next_step: "Close visual recipe",
      },
      {
        niche: "ru_cosmetics",
        platform: "instagram",
        label: "ru_cosmetics × instagram",
        lane: "validate",
        proof_quality: "traced_transfer_only",
        readiness_score: 74,
        missing_fields: ["audio strategy", "content action"],
        missing_field_families: ["audio", "execution"],
        blocked_reasons: ["нет exact-segment proof"],
        next_step: "Collect exact proof",
      },
    ],
  },
  shipReadyQueue: {
    top_ship_candidates: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        label: "ru_toys × tiktok",
        lane: "ship",
        proof_quality: "exact_segment",
        readiness_score: 94,
        ship_readiness_score: 91,
        missing_fields: ["visual recipe"],
        missing_field_families: ["visual"],
        primary_missing_family: "visual",
        blocked_reasons: [],
      },
    ],
  },
});

assert.equal(result.summary.total, 2);
assert.equal(result.summary.one_field_away_segments, 1);
assert.equal(result.summary.close_to_publishable_segments, 0);
assert.equal(result.top_candidates[0]?.label, "ru_toys × tiktok");
assert.equal(result.top_candidates[0]?.recommended_loop, "media_backfill");
assert.equal(result.top_candidates[0]?.closure_stage, "one_field_away");
assert.equal(result.top_candidates[0]?.unlocked_output, "publishable_visual_brief");
assert.equal(result.top_candidates[0]?.projected_production_state, "publishable_exact");
assert.equal(result.top_candidates[0]?.projected_trust_gain_band, "high");
assert.equal(result.top_candidates[1]?.recommended_loop, "collect_exact_proof");
assert.equal(result.top_candidates[1]?.unlocked_output, "exact_segment_evidence");
assert.equal(result.top_candidates[1]?.projected_production_state, "proof_needed");
assert.ok((result.summary.top_missing_family_hotspots || []).some((row) => row.label === "visual"));

console.log("reelsBrainBriefGapProgress.test: ok");
