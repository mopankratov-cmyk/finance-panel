import assert from "node:assert/strict";
import { buildReelsBrainPatternAtlas } from "./reelsBrainPatternAtlas";

function testBuildReelsBrainPatternAtlasFindsStableSegments() {
  const result = buildReelsBrainPatternAtlas({
    nicheSummaries: [
      {
        niche: "ru_toys",
        platform_brains: {
          tiktok: { total_videos: 120, analyzed_videos: 90, patterns: 7, generator_ready_patterns: 5 },
          instagram: { total_videos: 60, analyzed_videos: 30, patterns: 4, generator_ready_patterns: 2 },
        },
      },
      {
        niche: "ru_cosmetics",
        platform_brains: {
          youtube: { total_videos: 22, analyzed_videos: 9, patterns: 2, generator_ready_patterns: 0 },
        },
      },
    ],
    segmentTrust: {
      by_niche: [
        { niche: "ru_toys", score: 82, status: "ready", confidence: "high", note: "strong toys" },
        { niche: "ru_cosmetics", score: 37, status: "weak", confidence: "low", note: "weak cosmetics" },
      ],
      by_platform: [
        { platform: "tiktok", score: 79, status: "ready", confidence: "high", note: "strong tiktok" },
        { platform: "instagram", score: 58, status: "warming", confidence: "medium", note: "warming insta" },
        { platform: "youtube", score: 29, status: "weak", confidence: "low", note: "weak yt" },
      ],
    },
    patterns: [
      {
        id: "p1",
        title: "Fast demo surprise",
        hook: "Смотри что внутри",
        retention: "быстрый payoff",
        format: "demo",
        op_score: 92,
        confidence: "high",
        quality_gate: "high_confidence",
        final_decision: "scale",
        niches: ["ru_toys"],
        platforms: ["tiktok"],
        market_signal: { status: "proven", confidence: "high", best_platform: "tiktok", winners: 4, total_posts: 6 },
        creative_brief: { hook: "Смотри что внутри", retention_mechanic: "быстрый payoff", visual_recipe: ["macro"], audio_strategy: ["fast ugc"] },
      },
      {
        id: "p2",
        title: "Proof in hand",
        hook: "Показываю вживую",
        retention: "proof frame",
        format: "ugc",
        op_score: 78,
        confidence: "medium",
        quality_gate: "medium_confidence",
        final_decision: "control",
        niches: ["ru_toys"],
        platforms: ["tiktok", "instagram"],
        market_signal: { status: "promising", confidence: "medium", best_platform: "tiktok", winners: 2, total_posts: 5 },
        creative_brief: { hook: "Показываю вживую", retention_mechanic: "proof frame", visual_recipe: ["handheld"], audio_strategy: ["ugc voice"] },
      },
      {
        id: "p4",
        title: "Reveal after closeup",
        hook: "Сначала смотри деталь",
        retention: "closeup to reveal",
        format: "macro reveal",
        op_score: 88,
        confidence: "high",
        quality_gate: "high_confidence",
        final_decision: "scale",
        niches: ["ru_toys"],
        platforms: ["tiktok"],
        market_signal: { status: "proven", confidence: "high", best_platform: "tiktok", winners: 3, total_posts: 4 },
        creative_brief: { hook: "Сначала смотри деталь", retention_mechanic: "closeup to reveal", visual_recipe: ["macro reveal"], audio_strategy: ["surprise voice"] },
      },
      {
        id: "p3",
        title: "Long intro",
        hook: "Сегодня расскажу",
        retention: "slow intro",
        format: "talking head",
        op_score: 51,
        confidence: "low",
        quality_gate: "experimental",
        final_decision: "watch",
        niches: ["ru_cosmetics"],
        platforms: ["youtube"],
        market_signal: { status: "weak", confidence: "low", best_platform: "youtube", winners: 0, total_posts: 3 },
      },
      {
        id: "p5",
        title: "Demoted by weak market",
        hook: "Смотри быстро",
        retention: "fast payoff",
        format: "demo",
        op_score: 86,
        confidence: "high",
        quality_gate: "high_confidence",
        effective_quality_gate: "experimental",
        final_decision: "watch",
        niches: ["ru_cosmetics"],
        platforms: ["youtube"],
        market_signal: { status: "weak", confidence: "low", best_platform: "youtube", winners: 0, total_posts: 3 },
      },
    ],
    segmentLimit: 6,
    patternLimit: 3,
  });

  assert.equal(result.summary.segments, 3);
  assert.equal(result.summary.stable_segments, 1);
  assert.equal(result.by_segment[0]?.niche, "ru_toys");
  assert.equal(result.by_segment[0]?.platform, "tiktok");
  assert.equal(result.by_segment[0]?.status, "stable");
  assert.equal(result.by_segment[0]?.recommended_mode, "primary");
  assert.equal(result.by_segment[0]?.top_patterns[0]?.title, "Fast demo surprise");
  assert.equal(result.by_niche[0]?.niche, "ru_toys");
  assert.equal(result.by_platform[0]?.platform, "tiktok");
  assert.ok(!result.by_segment.find((row) => row.niche === "ru_cosmetics" && row.platform === "youtube")?.top_patterns.some((pattern) => pattern.title === "Demoted by weak market"));
  assert.equal(result.lookup.hasStableAtlas, true);
}

function run() {
  testBuildReelsBrainPatternAtlasFindsStableSegments();
  console.log("reelsBrainPatternAtlas.test: ok");
}

run();
