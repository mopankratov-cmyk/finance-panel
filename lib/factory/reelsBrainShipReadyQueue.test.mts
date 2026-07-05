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

console.log("reelsBrainShipReadyQueue.test: ok");
