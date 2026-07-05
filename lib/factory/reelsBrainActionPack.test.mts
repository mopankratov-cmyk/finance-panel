import assert from "node:assert/strict";
import { buildGroupedReelsBrainActionPacks, buildReelsBrainActionPack } from "./reelsBrainActionPack";

function testActionPackRanksScaleAndMarketProofAboveWatch() {
  const pack = buildReelsBrainActionPack([
    {
      id: "watch_1",
      title: "Watch pattern",
      op_score: 72,
      final_decision: "watch",
      confidence: "low",
      quality_gate: "experimental",
      warnings: ["Только A/B тест"],
      creative_brief: { hook: "hook 1", retention_mechanic: "proof", structure: "demo" },
      market_signal: { status: "weak", confidence: "low", winners: 0, total_posts: 2 },
    },
    {
      id: "scale_1",
      title: "Scale pattern",
      op_score: 90,
      final_decision: "scale",
      confidence: "high",
      quality_gate: "high_confidence",
      creative_brief: { hook: "hook 2", retention_mechanic: "open loop", structure: "demo" },
      market_signal: { status: "proven", confidence: "high", best_platform: "tiktok", winners: 4, total_posts: 5 },
    },
  ], 4);

  assert.ok(pack.primary);
  assert.equal(pack.primary?.pattern_id, "scale_1");
  assert.equal(pack.primary?.decision, "scale");
  assert.equal(pack.primary?.market_status, "proven");
  assert.equal(pack.alternatives.length, 1);
  assert.equal(pack.summary.scale, 1);
  assert.equal(pack.summary.watch, 1);
}

function testGroupedActionPacksSplitByNicheAndPlatform() {
  const grouped = buildGroupedReelsBrainActionPacks({
    patterns: [
      {
        id: "tiktok_toys",
        title: "TikTok toys",
        op_score: 88,
        final_decision: "scale",
        confidence: "high",
        niches: ["ru_toys"],
        platforms: ["tiktok"],
        creative_brief: { hook: "hook toys", retention_mechanic: "proof", structure: "demo" },
        market_signal: { status: "proven", confidence: "high", winners: 3, total_posts: 4 },
      },
      {
        id: "insta_cosmetics",
        title: "Instagram cosmetics",
        op_score: 81,
        final_decision: "control",
        confidence: "medium",
        niches: ["ru_cosmetics"],
        platforms: ["instagram"],
        creative_brief: { hook: "hook cosmetics", retention_mechanic: "review", structure: "review" },
        market_signal: { status: "promising", confidence: "medium", winners: 1, total_posts: 2 },
      },
    ],
    limit: 2,
  });

  assert.equal(grouped.by_niche.length, 2);
  assert.equal(grouped.by_platform.length, 2);
  assert.equal(grouped.by_niche.find((row) => row.niche === "ru_toys")?.primary?.pattern_id, "tiktok_toys");
  assert.equal(grouped.by_niche.find((row) => row.niche === "ru_cosmetics")?.primary?.pattern_id, "insta_cosmetics");
  assert.equal(grouped.by_platform.find((row) => row.platform === "tiktok")?.primary?.pattern_id, "tiktok_toys");
}

function testActionPackPrioritizesHighPayoffSegment() {
  const pack = buildReelsBrainActionPack([
    {
      id: "high_op_research",
      title: "High OP Research",
      op_score: 95,
      final_decision: "scale",
      confidence: "high",
      niches: ["ru_toys"],
      platforms: ["youtube"],
      creative_brief: { hook: "hook y", retention_mechanic: "proof", structure: "demo" },
      market_signal: { status: "proven", confidence: "high", winners: 3, total_posts: 5 },
    },
    {
      id: "primary_segment",
      title: "Primary Segment",
      op_score: 86,
      final_decision: "control",
      confidence: "medium",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: { hook: "hook t", retention_mechanic: "open loop", structure: "ugc" },
      market_signal: { status: "promising", confidence: "medium", winners: 1, total_posts: 2 },
    },
  ], 4, {
    segmentPriorityQueue: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        decision_priority_score: 93,
        urgency_score: 87,
        ready_for_generation: true,
        policy_mode: "primary",
        recommended_upgrade: {
          projected_trust_gain_score: 23,
          projected_production_state: "decision_ready",
          unlocked_output: "action rollouts",
        },
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        decision_priority_score: 42,
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
          decision_priority_score: 93,
          recommended_upgrade: {
            projected_trust_gain_score: 23,
            projected_production_state: "decision_ready",
            unlocked_output: "action rollouts",
          },
        },
      ],
    },
  });

  assert.equal(pack.primary?.pattern_id, "primary_segment");
  assert.equal(pack.primary?.segment_priority_mode, "primary");
  assert.equal(pack.primary?.segment_ready_for_generation, true);
  assert.equal(pack.summary.primary_policy_mode, "primary");
}

function testGroupedActionPacksSortBySegmentPriority() {
  const grouped = buildGroupedReelsBrainActionPacks({
    patterns: [
      {
        id: "yt_toys",
        title: "YT Toys",
        op_score: 94,
        final_decision: "scale",
        confidence: "high",
        niches: ["ru_toys"],
        platforms: ["youtube"],
        creative_brief: { hook: "hook y", retention_mechanic: "proof", structure: "demo" },
      },
      {
        id: "tt_cosmetics",
        title: "TT Cosmetics",
        op_score: 83,
        final_decision: "control",
        confidence: "medium",
        niches: ["ru_cosmetics"],
        platforms: ["tiktok"],
        creative_brief: { hook: "hook t", retention_mechanic: "proof", structure: "ugc" },
      },
    ],
    limit: 2,
    segmentPriorityQueue: [
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        decision_priority_score: 97,
        policy_mode: "primary",
        ready_for_generation: true,
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        decision_priority_score: 37,
        policy_mode: "research_only",
      },
    ],
  });

  assert.equal(grouped.by_niche[0]?.niche, "ru_cosmetics");
  assert.equal(grouped.by_platform[0]?.platform, "tiktok");
  assert.equal(grouped.by_segment[0]?.platform, "tiktok");
}

function run() {
  testActionPackRanksScaleAndMarketProofAboveWatch();
  testGroupedActionPacksSplitByNicheAndPlatform();
  testActionPackPrioritizesHighPayoffSegment();
  testGroupedActionPacksSortBySegmentPriority();
  console.log("reelsBrainActionPack.test: ok");
}

run();
