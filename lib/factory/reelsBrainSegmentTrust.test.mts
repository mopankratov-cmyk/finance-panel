import assert from "node:assert/strict";
import { applySegmentTrustToGroups, buildReelsBrainSegmentTrust, segmentRecommendationMode } from "./reelsBrainSegmentTrust";

function testBuildSegmentTrustByNicheAndPlatform() {
  const trust = buildReelsBrainSegmentTrust({
    niches: [
      {
        niche: "ru_toys",
        total_videos: 240,
        analyzed_videos: 180,
        patterns: 18,
        generator_ready_patterns: 9,
        understanding_score: 84,
        platform_brains: {
          tiktok: { total_videos: 120, analyzed_videos: 95, patterns: 8, generator_ready_patterns: 5 },
          instagram: { total_videos: 70, analyzed_videos: 55, patterns: 6, generator_ready_patterns: 3 },
        },
      },
      {
        niche: "ru_cosmetics",
        total_videos: 120,
        analyzed_videos: 48,
        patterns: 7,
        generator_ready_patterns: 2,
        understanding_score: 51,
        platform_brains: {
          instagram: { total_videos: 80, analyzed_videos: 35, patterns: 5, generator_ready_patterns: 2 },
          youtube: { total_videos: 25, analyzed_videos: 8, patterns: 1, generator_ready_patterns: 0 },
        },
      },
    ],
  });

  assert.equal(trust.by_niche.length, 2);
  assert.equal(trust.by_platform.length, 3);
  assert.equal(trust.by_niche[0]?.niche, "ru_toys");
  assert.equal(trust.by_niche[0]?.status, "ready");
  assert.equal(trust.by_platform.find((row) => row.platform === "tiktok")?.status, "warming");
  assert.equal(trust.by_platform.find((row) => row.platform === "youtube")?.status, "weak");
}

function testSegmentRecommendationModeAndGroupOrdering() {
  const trust = buildReelsBrainSegmentTrust({
    niches: [
      {
        niche: "ru_toys",
        total_videos: 240,
        analyzed_videos: 180,
        patterns: 18,
        generator_ready_patterns: 9,
        understanding_score: 84,
        platform_brains: { tiktok: { total_videos: 120, analyzed_videos: 95, patterns: 8, generator_ready_patterns: 5 } },
      },
      {
        niche: "ru_cosmetics",
        total_videos: 120,
        analyzed_videos: 48,
        patterns: 7,
        generator_ready_patterns: 2,
        understanding_score: 51,
        platform_brains: { instagram: { total_videos: 80, analyzed_videos: 35, patterns: 5, generator_ready_patterns: 2 } },
      },
    ],
  });

  const groups = applySegmentTrustToGroups({
    groups: [
      { niche: "ru_cosmetics", primary: { title: "Weak pack" } },
      { niche: "ru_toys", primary: { title: "Strong pack" } },
    ],
    trustRows: trust.by_niche,
    key: "niche",
  });

  assert.equal(segmentRecommendationMode("ready"), "primary");
  assert.equal(segmentRecommendationMode("warming"), "control_only");
  assert.equal(segmentRecommendationMode("weak"), "research_only");
  assert.equal(groups[0]?.niche, "ru_toys");
  assert.equal(groups[0]?.primary_allowed, true);
  assert.equal(groups[1]?.recommended_mode, "research_only");
}

function run() {
  testBuildSegmentTrustByNicheAndPlatform();
  testSegmentRecommendationModeAndGroupOrdering();
  console.log("reelsBrainSegmentTrust.test: ok");
}

run();
