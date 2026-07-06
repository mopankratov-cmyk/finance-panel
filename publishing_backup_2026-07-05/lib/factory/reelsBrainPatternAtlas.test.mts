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
    segmentReadiness: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        total_backlog: 0,
        dominant_gap: { key: "analyze", count: 0 },
        direct_rate: 91,
        audio_rate: 88,
        transcript_ready_rate: 84,
        analyzed_rate: 75,
      },
      {
        niche: "ru_toys",
        platform: "instagram",
        total_backlog: 12,
        dominant_gap: { key: "audio", count: 7 },
        direct_rate: 73,
        audio_rate: 28,
        transcript_ready_rate: 19,
        analyzed_rate: 50,
      },
      {
        niche: "ru_cosmetics",
        platform: "youtube",
        total_backlog: 18,
        dominant_gap: { key: "media", count: 10 },
        direct_rate: 22,
        audio_rate: 9,
        transcript_ready_rate: 4,
        analyzed_rate: 41,
      },
    ],
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
  assert.equal(result.by_segment[0]?.audio_foundation_status, "ready");
  assert.equal(result.by_segment.find((row) => row.niche === "ru_toys" && row.platform === "instagram")?.readiness_status, "thin");
  assert.equal(result.by_segment.find((row) => row.niche === "ru_toys" && row.platform === "instagram")?.audio_foundation_status, "weak");
  assert.equal(result.by_segment.find((row) => row.niche === "ru_toys" && row.platform === "instagram")?.recommended_mode, "research_only");
  assert.equal(result.by_segment[0]?.top_patterns[0]?.title, "Fast demo surprise");
  assert.equal(result.by_niche[0]?.niche, "ru_toys");
  assert.equal(result.by_platform[0]?.platform, "tiktok");
  assert.ok(!result.by_segment.find((row) => row.niche === "ru_cosmetics" && row.platform === "youtube")?.top_patterns.some((pattern) => pattern.title === "Demoted by weak market"));
  assert.equal(result.lookup.hasStableAtlas, true);
}

function testPatternAtlasPrioritizesHighPayoffSegment() {
  const result = buildReelsBrainPatternAtlas({
    nicheSummaries: [
      {
        niche: "ru_toys",
        platform_brains: {
          youtube: { total_videos: 120, analyzed_videos: 92, patterns: 6, generator_ready_patterns: 4 },
        },
      },
      {
        niche: "ru_cosmetics",
        platform_brains: {
          tiktok: { total_videos: 64, analyzed_videos: 34, patterns: 3, generator_ready_patterns: 2 },
        },
      },
    ],
    segmentTrust: {
      by_niche: [
        { niche: "ru_toys", score: 80, status: "ready" },
        { niche: "ru_cosmetics", score: 58, status: "warming" },
      ],
      by_platform: [
        { platform: "youtube", score: 74, status: "ready" },
        { platform: "tiktok", score: 61, status: "warming" },
      ],
    },
    patterns: [
      {
        id: "yt_toys_best",
        title: "YT Toys Best",
        hook: "Смотри быстро",
        retention: "open loop",
        format: "demo",
        op_score: 95,
        confidence: "high",
        quality_gate: "high_confidence",
        final_decision: "scale",
        niches: ["ru_toys"],
        platforms: ["youtube"],
        market_signal: { status: "proven", confidence: "high", winners: 4, total_posts: 6 },
      },
      {
        id: "tt_cosmetics_good",
        title: "TT Cosmetics Good",
        hook: "Смотри эффект",
        retention: "proof",
        format: "ugc",
        op_score: 84,
        confidence: "medium",
        quality_gate: "medium_confidence",
        final_decision: "control",
        niches: ["ru_cosmetics"],
        platforms: ["tiktok"],
        market_signal: { status: "promising", confidence: "medium", winners: 1, total_posts: 2 },
      },
    ],
    segmentPriorityQueue: [
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        decision_priority_score: 96,
        policy_mode: "primary",
        ready_for_generation: true,
        recommended_upgrade: {
          projected_trust_gain_score: 26,
          projected_production_state: "decision_ready",
          unlocked_output: "segment atlas candidates",
        },
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        decision_priority_score: 42,
        policy_mode: "research_only",
      },
    ],
    segmentLimit: 6,
    patternLimit: 2,
  });

  assert.equal(result.by_segment[0]?.niche, "ru_cosmetics");
  assert.equal(result.by_segment[0]?.platform, "tiktok");
  assert.equal(result.by_segment[0]?.segment_priority_mode, "primary");
  assert.equal(result.summary.primary_priority_segments, 1);
}

function testPatternAtlasSurfacesTrustAwareMemoryContext() {
  const result = buildReelsBrainPatternAtlas({
    nicheSummaries: [
      {
        niche: "ru_clothing",
        platform_brains: {
          instagram: { total_videos: 72, analyzed_videos: 51, patterns: 4, generator_ready_patterns: 2 },
          youtube: { total_videos: 118, analyzed_videos: 86, patterns: 6, generator_ready_patterns: 4 },
        },
      },
    ],
    segmentTrust: {
      by_niche: [{ niche: "ru_clothing", score: 79, status: "ready", note: "strong clothing" }],
      by_platform: [
        { platform: "instagram", score: 61, status: "warming", note: "warming insta" },
        { platform: "youtube", score: 77, status: "ready", note: "strong yt" },
      ],
    },
    patterns: [
      {
        id: "ig_pat",
        title: "IG exact pattern",
        hook: "Смотри посадку",
        retention: "try-on proof",
        format: "ugc",
        op_score: 84,
        confidence: "high",
        quality_gate: "high_confidence",
        final_decision: "control",
        niches: ["ru_clothing"],
        platforms: ["instagram"],
        market_signal: { status: "proven", confidence: "high", winners: 2, total_posts: 3 },
      },
      {
        id: "yt_pat",
        title: "YT transfer pattern",
        hook: "Смотри материал",
        retention: "review proof",
        format: "review",
        op_score: 95,
        confidence: "high",
        quality_gate: "high_confidence",
        final_decision: "scale",
        niches: ["ru_clothing"],
        platforms: ["youtube"],
        market_signal: { status: "proven", confidence: "high", winners: 4, total_posts: 6 },
      },
    ],
    generationPolicy: {
      by_segment: [
        {
          niche: "ru_clothing",
          platform: "instagram",
          policy_mode: "primary",
          trust_band: "high_trust",
          evidence_band: "exact",
          high_trust_generation_ready: true,
          publishable_exact: true,
          proof_quality: "exact_segment",
          policy_reason: "Exact proof already closed for this segment.",
          decision_priority_score: 88,
        },
        {
          niche: "ru_clothing",
          platform: "youtube",
          policy_mode: "primary",
          trust_band: "transfer_only",
          evidence_band: "borrowed",
          high_trust_generation_ready: false,
          publishable_exact: false,
          proof_quality: "traced_transfer_only",
          policy_reason: "Still borrowed from transfer evidence.",
          decision_priority_score: 95,
        },
      ],
    },
    segmentLimit: 6,
    patternLimit: 2,
  });

  assert.equal(result.by_segment[0]?.platform, "instagram");
  assert.equal(result.by_segment[0]?.proof_quality, "exact_segment");
  assert.equal(result.by_segment[0]?.high_trust_generation_ready, true);
  assert.equal(result.by_segment[0]?.publishable_exact, true);
  assert.equal(result.by_segment[0]?.trust_band, "high_trust");
  assert.equal(result.by_segment[0]?.evidence_band, "exact");
  assert.match(String(result.by_segment[0]?.policy_reason), /Exact proof/i);
  assert.equal(result.summary.exact_proof_ready, 1);
  assert.equal(result.summary.generation_ready, 1);
}

function run() {
  testBuildReelsBrainPatternAtlasFindsStableSegments();
  testPatternAtlasPrioritizesHighPayoffSegment();
  testPatternAtlasSurfacesTrustAwareMemoryContext();
  console.log("reelsBrainPatternAtlas.test: ok");
}

run();
