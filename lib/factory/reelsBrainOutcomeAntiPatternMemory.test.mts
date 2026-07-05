import assert from "node:assert/strict";
import { buildReelsBrainOutcomeAntiPatternMemory } from "./reelsBrainOutcomeAntiPatternMemory";

function testBuildReelsBrainOutcomeAntiPatternMemoryWritesWeakAndPromisingSegments() {
  const result = buildReelsBrainOutcomeAntiPatternMemory({
    feedbackLoop: {
      by_segment: [
        {
          segment: "ru_toys × tiktok",
          niche: "ru_toys",
          platform: "tiktok",
          status: "weak",
          posts: 3,
          winners: 0,
          losers: 2,
          trust_action: "review_or_penalize_segment",
          evidence: "0 winners / 3 posts",
        },
        {
          segment: "ru_clothing × instagram",
          niche: "ru_clothing",
          platform: "instagram",
          status: "promising",
          posts: 2,
          winners: 1,
          losers: 0,
          trust_action: "keep_validating_segment",
          evidence: "1 winner / 2 posts",
        },
      ],
    },
    patternOutcomeMemory: {
      decaying_patterns: [
        {
          pattern_id: "pattern-decay",
          title: "Decay pattern",
          total_posts: 3,
          winners: 0,
          losers: 2,
          best_segment: "ru_toys × youtube",
          trust_write: "degrade_pattern_priority",
        },
      ],
      promotion_queue: [
        {
          pattern_id: "pattern-warm",
          title: "Warm pattern",
          total_posts: 2,
          winners: 1,
          losers: 0,
          best_segment: "ru_toys × tiktok",
          trust_write: "keep_validating_pattern",
        },
      ],
    },
    limit: 6,
  });

  assert.equal(result.count, 4);
  const byCode = new Map(result.items.map((item) => [item.code, item] as const));
  assert.equal(byCode.get("weak_segment_ru_toys_tiktok")?.severity, "high");
  assert.ok(String(byCode.get("weak_segment_ru_toys_tiktok")?.action || "").includes("Не пускать текущую механику"));
  assert.equal(byCode.get("weak_pattern_pattern-decay")?.severity, "high");
  assert.equal(byCode.get("promising_pattern_pattern-warm")?.severity, "medium");
  assert.equal(byCode.get("promising_segment_ru_clothing_instagram")?.severity, "medium");
}

function run() {
  testBuildReelsBrainOutcomeAntiPatternMemoryWritesWeakAndPromisingSegments();
  console.log("reelsBrainOutcomeAntiPatternMemory.test: ok");
}

run();
