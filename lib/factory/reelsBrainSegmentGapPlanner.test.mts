import assert from "node:assert/strict";
import { buildReelsBrainSegmentGapPlanner } from "./reelsBrainSegmentGapPlanner";

function testBuildReelsBrainSegmentGapPlannerFindsWeakSegments() {
  const result = buildReelsBrainSegmentGapPlanner({
    targetTotal: 1000,
    niches: [
      {
        niche: "ru_toys",
        platform_brains: {
          tiktok: { total_videos: 180, analyzed_videos: 120, generator_ready_patterns: 4 },
          instagram: { total_videos: 60, analyzed_videos: 25, generator_ready_patterns: 1 },
          youtube: { total_videos: 20, analyzed_videos: 8, generator_ready_patterns: 0 },
        },
      },
    ],
    patternAtlas: {
      by_segment: [
        { niche: "ru_toys", platform: "tiktok", status: "stable", stable_pattern_count: 3, avg_stability_score: 84 },
        { niche: "ru_toys", platform: "instagram", status: "forming", stable_pattern_count: 1, avg_stability_score: 61 },
        { niche: "ru_toys", platform: "youtube", status: "thin", stable_pattern_count: 0, avg_stability_score: 28 },
      ],
    },
    limit: 6,
  });

  assert.equal(result.summary.total_segments, 3);
  assert.equal(result.summary.stable, 1);
  assert.equal(result.focus_segments[0]?.platform, "youtube");
  assert.equal(result.focus_segments[0]?.status, "grow_corpus");
  assert.equal(result.stable_segments[0]?.platform, "tiktok");
  assert.equal(result.stable_segments[0]?.status, "stable");
}

function run() {
  testBuildReelsBrainSegmentGapPlannerFindsWeakSegments();
  console.log("reelsBrainSegmentGapPlanner.test: ok");
}

run();
