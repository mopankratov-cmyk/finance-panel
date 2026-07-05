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

function run() {
  testBuildBriefPackRanksByOpScoreAndConfidence();
  testBuildBriefPackDemotesReadinessThinRecipe();
  testGroupedBriefPacksSplitByNicheAndPlatform();
  console.log("reelsBrainBriefPack.test: ok");
}

run();
