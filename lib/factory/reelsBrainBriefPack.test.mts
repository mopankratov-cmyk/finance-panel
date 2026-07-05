import assert from "node:assert/strict";
import { buildGroupedReelsBrainBriefPacks, buildReelsBrainBriefPack } from "./reelsBrainBriefPack";

function testBuildBriefPackRanksByOpScoreAndConfidence() {
  const pack = buildReelsBrainBriefPack([
    {
      id: "tiktok_toys_best",
      title: "TikTok Toys Best",
      op_score: 92,
      confidence: "high",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: {
        hook: "Смотри что делает",
        retention_mechanic: "open loop",
        second_by_second: ["0-2с хук", "2-5с proof"],
        visual_recipe: ["close-up proof"],
        audio_strategy: ["fast voice"],
        product_fit: ["toy demo"],
      },
      examples: [{ reference_id: "r1" }],
    },
    {
      id: "tiktok_toys_alt",
      title: "TikTok Toys Alt",
      op_score: 81,
      confidence: "medium",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: {
        hook: "Я не ожидала",
        retention_mechanic: "proof",
      },
    },
  ], 3, {
    segmentReadiness: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        total_backlog: 0,
        dominant_gap: { key: "analyze", count: 0 },
        direct_rate: 88,
        audio_rate: 82,
        transcript_ready_rate: 75,
        analyzed_rate: 70,
      },
    ],
  });

  assert.equal(pack.primary?.recipe_id, "tiktok_toys_best");
  assert.equal(pack.alternatives.length, 1);
  assert.equal(pack.summary.total, 2);
  assert.equal(pack.summary.high_confidence, 1);
  assert.equal(pack.primary?.readiness_status, "backed");
}

function testBuildBriefPackDemotesReadinessThinRecipe() {
  const pack = buildReelsBrainBriefPack([
    {
      id: "yt_toys_high_but_thin",
      title: "YouTube Toys Thin",
      op_score: 95,
      confidence: "high",
      niches: ["ru_toys"],
      platforms: ["youtube"],
      creative_brief: {
        hook: "Смотри быстро",
        retention_mechanic: "open loop",
      },
    },
    {
      id: "tt_toys_backed",
      title: "TikTok Toys Backed",
      op_score: 88,
      confidence: "medium",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: {
        hook: "Я не ожидала",
        retention_mechanic: "proof",
      },
    },
  ], 3, {
    segmentReadiness: [
      {
        niche: "ru_toys",
        platform: "youtube",
        total_backlog: 20,
        dominant_gap: { key: "audio", count: 11 },
        direct_rate: 74,
        audio_rate: 18,
        transcript_ready_rate: 10,
        analyzed_rate: 42,
      },
      {
        niche: "ru_toys",
        platform: "tiktok",
        total_backlog: 0,
        dominant_gap: { key: "analyze", count: 0 },
        direct_rate: 90,
        audio_rate: 85,
        transcript_ready_rate: 80,
        analyzed_rate: 77,
      },
    ],
  });

  assert.equal(pack.primary?.recipe_id, "tt_toys_backed");
  assert.equal(pack.alternatives[0]?.recipe_id, "yt_toys_high_but_thin");
  assert.equal(pack.alternatives[0]?.readiness_status, "thin");
}

function testGroupedBriefPacksSplitByNicheAndPlatform() {
  const grouped = buildGroupedReelsBrainBriefPacks({
    recipes: [
      {
        id: "tiktok_toys_best",
        title: "TikTok Toys Best",
        op_score: 92,
        confidence: "high",
        niches: ["ru_toys"],
        platforms: ["tiktok"],
        creative_brief: { hook: "Смотри что делает", retention_mechanic: "open loop" },
      },
      {
        id: "insta_cosmetics_best",
        title: "Instagram Cosmetics Best",
        op_score: 86,
        confidence: "medium",
        niches: ["ru_cosmetics"],
        platforms: ["instagram"],
        creative_brief: { hook: "Я не ожидала", retention_mechanic: "proof" },
      },
    ],
    limit: 2,
  });

  assert.equal(grouped.by_niche.length, 2);
  assert.equal(grouped.by_platform.length, 2);
  assert.equal(grouped.by_platform.find((row) => row.platform === "tiktok")?.primary?.recipe_id, "tiktok_toys_best");
  assert.equal(grouped.by_platform.find((row) => row.platform === "instagram")?.primary?.recipe_id, "insta_cosmetics_best");
}

function testBriefPackPrioritizesHighPayoffSegment() {
  const pack = buildReelsBrainBriefPack([
    {
      id: "high_op_research_only",
      title: "High OP Research",
      op_score: 94,
      confidence: "high",
      niches: ["ru_toys"],
      platforms: ["youtube"],
      creative_brief: {
        hook: "Смотри до конца",
        retention_mechanic: "open loop",
      },
    },
    {
      id: "slightly_lower_but_primary",
      title: "Primary Segment Winner",
      op_score: 88,
      confidence: "medium",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: {
        hook: "Я не ожидала",
        retention_mechanic: "proof",
      },
    },
  ], 3, {
    segmentPriorityQueue: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        decision_priority_score: 91,
        urgency_score: 84,
        ready_for_generation: true,
        policy_mode: "primary",
        recommended_upgrade: {
          projected_trust_gain_score: 22,
          projected_production_state: "decision_ready",
          unlocked_output: "platform-specific briefs",
        },
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        decision_priority_score: 38,
        urgency_score: 30,
        ready_for_generation: false,
        policy_mode: "research_only",
      },
    ],
    generationPolicy: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          policy_mode: "primary",
          decision_priority_score: 91,
          recommended_upgrade: {
            projected_trust_gain_score: 22,
            projected_production_state: "decision_ready",
            unlocked_output: "platform-specific briefs",
          },
        },
      ],
    },
  });

  assert.equal(pack.primary?.recipe_id, "slightly_lower_but_primary");
  assert.equal(pack.primary?.segment_priority_mode, "primary");
  assert.equal(pack.primary?.segment_ready_for_generation, true);
  assert.equal(pack.primary?.projected_production_state, "decision_ready");
  assert.equal(pack.summary.primary_policy_mode, "primary");
}

function testGroupedBriefPacksSortBySegmentPriority() {
  const grouped = buildGroupedReelsBrainBriefPacks({
    recipes: [
      {
        id: "yt_toys",
        title: "YT Toys",
        op_score: 93,
        confidence: "high",
        niches: ["ru_toys"],
        platforms: ["youtube"],
        creative_brief: { hook: "Досмотри", retention_mechanic: "open loop" },
      },
      {
        id: "tt_cosmetics",
        title: "TT Cosmetics",
        op_score: 87,
        confidence: "medium",
        niches: ["ru_cosmetics"],
        platforms: ["tiktok"],
        creative_brief: { hook: "Смотри эффект", retention_mechanic: "proof" },
      },
    ],
    limit: 2,
    segmentPriorityQueue: [
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        decision_priority_score: 95,
        policy_mode: "primary",
        ready_for_generation: true,
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        decision_priority_score: 35,
        policy_mode: "research_only",
      },
    ],
  });

  assert.equal(grouped.by_niche[0]?.niche, "ru_cosmetics");
  assert.equal(grouped.by_platform[0]?.platform, "tiktok");
  assert.equal(grouped.by_segment[0]?.platform, "tiktok");
}

function run() {
  testBuildBriefPackRanksByOpScoreAndConfidence();
  testBuildBriefPackDemotesReadinessThinRecipe();
  testGroupedBriefPacksSplitByNicheAndPlatform();
  testBriefPackPrioritizesHighPayoffSegment();
  testGroupedBriefPacksSortBySegmentPriority();
  console.log("reelsBrainBriefPack.test: ok");
}

run();
