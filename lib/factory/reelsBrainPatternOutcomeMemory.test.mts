import assert from "node:assert/strict";
import { buildReelsBrainPatternOutcomeMemory } from "./reelsBrainPatternOutcomeMemory";

function testBuildReelsBrainPatternOutcomeMemorySplitsStablePromotionAndDecay() {
  const result = buildReelsBrainPatternOutcomeMemory({
    patterns: [
      {
        id: "stable-1",
        title: "Stable winner",
        quality_gate: "high_confidence",
        market_signal: { status: "proven", confidence: "high", score: 88, winners: 3, losers: 0, total_posts: 4, best_platform: "tiktok", best_segment: "ru_toys × tiktok" },
        outcome_writeback: { trust_write: "promote_pattern_priority", final_decision: "scale" },
      },
      {
        id: "warm-1",
        title: "Promising pattern",
        quality_gate: "medium_confidence",
        market_signal: { status: "promising", confidence: "medium", score: 61, winners: 1, losers: 0, total_posts: 2, best_platform: "instagram", best_segment: "ru_beauty × instagram" },
        outcome_writeback: { trust_write: "keep_validating_pattern", final_decision: "control" },
      },
      {
        id: "weak-1",
        title: "Decaying pattern",
        quality_gate: "high_confidence",
        market_signal: { status: "weak", confidence: "low", score: 22, winners: 0, losers: 2, total_posts: 3, best_platform: "youtube", best_segment: "ru_toys × youtube" },
        outcome_writeback: { trust_write: "degrade_pattern_priority", final_decision: "watch", quality_gate_override: "medium_confidence" },
      },
      {
        id: "cold-1",
        title: "No feedback yet",
        quality_gate: "high_confidence",
        market_signal: { status: "no_feedback", confidence: "low", score: 0, winners: 0, losers: 0, total_posts: 0 },
      },
    ],
    limit: 4,
  });

  assert.equal(result.status, "seeded");
  assert.equal(result.by_status.proven, 1);
  assert.equal(result.by_status.promising, 1);
  assert.equal(result.by_status.weak, 1);
  assert.equal(result.by_status.no_feedback, 1);
  assert.equal(result.stable_patterns[0]?.pattern_id, "stable-1");
  assert.equal(result.promotion_queue[0]?.pattern_id, "warm-1");
  assert.equal(result.decaying_patterns[0]?.pattern_id, "weak-1");
  assert.equal(result.trust_write_queue.length, 3);
  assert.equal(result.coverage_rate, 75);
}

function run() {
  testBuildReelsBrainPatternOutcomeMemorySplitsStablePromotionAndDecay();
  console.log("reelsBrainPatternOutcomeMemory.test: ok");
}

run();
