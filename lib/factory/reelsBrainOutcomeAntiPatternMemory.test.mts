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
    limit: 6,
  });

  assert.equal(result.count, 2);
  assert.equal(result.items[0]?.code, "weak_segment_ru_toys_tiktok");
  assert.equal(result.items[0]?.severity, "high");
  assert.ok(result.items[0]?.action.includes("Не пускать текущую механику"));
  assert.equal(result.items[1]?.code, "promising_segment_ru_clothing_instagram");
  assert.equal(result.items[1]?.severity, "medium");
}

function run() {
  testBuildReelsBrainOutcomeAntiPatternMemoryWritesWeakAndPromisingSegments();
  console.log("reelsBrainOutcomeAntiPatternMemory.test: ok");
}

run();

