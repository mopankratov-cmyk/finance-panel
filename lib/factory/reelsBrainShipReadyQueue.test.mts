import assert from "node:assert/strict";
import { buildReelsBrainShipReadyQueue } from "./reelsBrainShipReadyQueue";

const result = buildReelsBrainShipReadyQueue({
  briefCoverageAudit: {
    gap_queue: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        label: "ru_toys × tiktok",
        lane: "ship",
        proof_quality: "exact_segment",
        readiness_score: 86,
        missing_fields: ["structure"],
        blocked_reasons: [],
        next_step: "Fill structure",
      },
      {
        niche: "ru_cosmetics",
        platform: "instagram",
        label: "ru_cosmetics × instagram",
        lane: "validate",
        proof_quality: "traced_transfer_only",
        readiness_score: 72,
        missing_fields: ["content action", "structure"],
        blocked_reasons: ["trust score ниже decision-grade порога"],
        next_step: "Collect exact proof",
      },
    ],
  },
  segmentGenerationPacks: {
    items: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        readiness_score: 88,
        quality_gate: {
          allowed_generation_modes: ["decision_ready"],
        },
      },
    ],
  },
});

assert.equal(result.summary.total_gaps, 2);
assert.equal(result.summary.ship_candidates, 1);
assert.equal(result.summary.validate_candidates, 1);
assert.equal(result.top_ship_candidates[0]?.platform, "tiktok");
assert.equal(result.top_ship_candidates[0]?.ship_readiness_score > result.top_validate_candidates[0]?.ship_readiness_score, true);
assert.deepEqual(result.top_ship_candidates[0]?.generation_modes, ["decision_ready"]);
assert.equal(result.top_ship_candidates[0]?.primary_missing_family, "structure");
assert.deepEqual(result.top_ship_candidates[0]?.field_fill_order, ["structure"]);
assert.equal((result.summary.missing_family_hotspots || [])[0]?.label, "structure");

const prioritized = buildReelsBrainShipReadyQueue({
  briefCoverageAudit: {
    gap_queue: [
      {
        niche: "ru_toys",
        platform: "youtube",
        label: "ru_toys × youtube",
        lane: "ship",
        proof_quality: "exact_segment",
        readiness_score: 88,
        missing_fields: ["structure"],
        blocked_reasons: [],
        next_step: "Fill structure",
        segment_priority_score: 42,
        segment_priority_mode: "research_only",
      },
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        label: "ru_cosmetics × tiktok",
        lane: "validate",
        proof_quality: "traced_transfer_only",
        readiness_score: 74,
        missing_fields: ["content action"],
        blocked_reasons: [],
        next_step: "Validate exact proof",
        segment_priority_score: 97,
        segment_priority_mode: "primary",
        segment_ready_for_generation: true,
      },
    ],
  },
  segmentGenerationPacks: {
    items: [
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        readiness_score: 74,
        quality_gate: {
          allowed_generation_modes: ["control_ready"],
        },
        segment_priority_score: 97,
        segment_priority_mode: "primary",
      },
    ],
  },
});

assert.equal(prioritized.items[0]?.platform, "tiktok");
assert.equal(prioritized.items[0]?.segment_priority_mode, "primary");
assert.equal(prioritized.summary.primary_priority_segments, 1);

console.log("reelsBrainShipReadyQueue.test: ok");
