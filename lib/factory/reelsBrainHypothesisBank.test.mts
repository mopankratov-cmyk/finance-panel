import assert from "node:assert/strict";
import { buildGroupedReelsBrainHypothesisBanks, buildReelsBrainHypothesisBank } from "./reelsBrainHypothesisBank";

function testBuildHypothesisBankRanksDecisionAndFeedback() {
  const bank = buildReelsBrainHypothesisBank([
    {
      id: "pattern_scale",
      title: "Scale-worthy proof demo",
      hook: "Смотри что делает",
      format: "demo",
      retention: "open loop",
      op_score: 91,
      confidence: "high",
      quality_gate: "high_confidence",
      final_decision: "scale",
      niches: ["ru_toys"],
      platforms: ["tiktok", "instagram"],
      creative_brief: {
        hook: "Смотри что делает",
        retention_mechanic: "open loop",
        visual_recipe: ["proof close-up"],
        audio_strategy: ["fast voice"],
        product_fit: ["toy demo"],
        do_not_copy: ["чужую музыку"],
      },
      market_signal: {
        status: "proven",
        confidence: "high",
        best_platform: "tiktok",
        winners: 4,
        losers: 0,
        total_posts: 6,
      },
    },
    {
      id: "pattern_watch",
      title: "Watch-only review",
      hook: "Я не ожидала",
      format: "review",
      retention: "proof",
      op_score: 68,
      confidence: "low",
      quality_gate: "experimental",
      final_decision: "watch",
      niches: ["ru_cosmetics"],
      platforms: ["youtube"],
      warnings: ["Только A/B тест, не масштабировать без факта."],
      market_signal: {
        status: "weak",
        confidence: "low",
        winners: 0,
        losers: 2,
        total_posts: 2,
      },
    },
  ]);

  assert.equal(bank.summary.total, 2);
  assert.equal(bank.summary.scale, 1);
  assert.equal(bank.summary.watch, 1);
  assert.equal(bank.summary.proven, 1);
  assert.equal(bank.cards[0]?.id, "pattern_scale");
  assert.equal(bank.cards[0]?.decision, "scale");
  assert.equal(bank.cards[0]?.market_status, "proven");
  assert.ok(bank.cards[0]?.hypothesis.includes("Смотри что делает"));
  assert.ok(bank.cards[0]?.guardrails.some((item) => item.includes("музы")));
  assert.equal(bank.cards[1]?.market_status, "weak");
  assert.ok(bank.cards[1]?.success_metric.includes("первый сильный сигнал"));
}

function testGroupedHypothesisBanksSplitByNicheAndPlatform() {
  const grouped = buildGroupedReelsBrainHypothesisBanks({
    patterns: [
      {
        id: "pattern_toys_tiktok",
        title: "Toys TikTok",
        hook: "Смотри что делает",
        format: "demo",
        retention: "open loop",
        op_score: 91,
        confidence: "high",
        quality_gate: "high_confidence",
        final_decision: "scale",
        niches: ["ru_toys"],
        platforms: ["tiktok"],
        creative_brief: {
          hook: "Смотри что делает",
          retention_mechanic: "open loop",
          visual_recipe: ["proof close-up"],
          audio_strategy: ["fast voice"],
          product_fit: ["toy demo"],
        },
        market_signal: {
          status: "proven",
          confidence: "high",
          best_platform: "tiktok",
          winners: 4,
          total_posts: 6,
        },
      },
      {
        id: "pattern_cosmetics_instagram",
        title: "Cosmetics Instagram",
        hook: "Я не ожидала",
        format: "review",
        retention: "proof",
        op_score: 82,
        confidence: "medium",
        quality_gate: "medium_confidence",
        final_decision: "control",
        niches: ["ru_cosmetics"],
        platforms: ["instagram"],
        creative_brief: {
          hook: "Я не ожидала",
          retention_mechanic: "proof",
          visual_recipe: ["ugc review"],
          audio_strategy: ["clean voice"],
          product_fit: ["cosmetics review"],
        },
        market_signal: {
          status: "promising",
          confidence: "medium",
          best_platform: "instagram",
          winners: 1,
          total_posts: 2,
        },
      },
    ],
    limit: 2,
  });

  assert.equal(grouped.by_niche.length, 2);
  assert.equal(grouped.by_platform.length, 2);
  assert.equal(grouped.by_niche[0]?.summary?.total, 1);
  assert.equal(grouped.by_platform.find((row) => row.platform === "tiktok")?.cards[0]?.id, "pattern_toys_tiktok");
  assert.equal(grouped.by_platform.find((row) => row.platform === "instagram")?.cards[0]?.id, "pattern_cosmetics_instagram");
}

function testHypothesisBankPrioritizesHighPayoffSegment() {
  const bank = buildReelsBrainHypothesisBank([
    {
      id: "pattern_high_op_research",
      title: "High OP Research",
      hook: "Смотри быстро",
      format: "demo",
      retention: "open loop",
      op_score: 95,
      confidence: "high",
      final_decision: "scale",
      niches: ["ru_toys"],
      platforms: ["youtube"],
      creative_brief: {
        hook: "Смотри быстро",
        retention_mechanic: "open loop",
      },
    },
    {
      id: "pattern_primary_segment",
      title: "Primary Segment",
      hook: "Я не ожидала",
      format: "ugc",
      retention: "proof",
      op_score: 86,
      confidence: "medium",
      final_decision: "control",
      niches: ["ru_toys"],
      platforms: ["tiktok"],
      creative_brief: {
        hook: "Я не ожидала",
        retention_mechanic: "proof",
      },
    },
  ], 8, {
    segmentPriorityQueue: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        decision_priority_score: 92,
        urgency_score: 85,
        ready_for_generation: true,
        policy_mode: "primary",
        recommended_upgrade: {
          projected_trust_gain_score: 24,
          projected_production_state: "decision_ready",
          unlocked_output: "segment hypotheses",
        },
      },
      {
        niche: "ru_toys",
        platform: "youtube",
        decision_priority_score: 40,
        urgency_score: 33,
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
          decision_priority_score: 92,
          recommended_upgrade: {
            projected_trust_gain_score: 24,
            projected_production_state: "decision_ready",
            unlocked_output: "segment hypotheses",
          },
        },
      ],
    },
  });

  assert.equal(bank.cards[0]?.id, "pattern_primary_segment");
  assert.equal(bank.cards[0]?.segment_priority_mode, "primary");
  assert.equal(bank.cards[0]?.segment_ready_for_generation, true);
  assert.equal(bank.summary.primary_policy_mode, "primary");
}

function testGroupedHypothesisBanksSortBySegmentPriority() {
  const grouped = buildGroupedReelsBrainHypothesisBanks({
    patterns: [
      {
        id: "yt_toys",
        title: "YT Toys",
        hook: "Смотри быстро",
        format: "demo",
        retention: "open loop",
        op_score: 94,
        confidence: "high",
        final_decision: "scale",
        niches: ["ru_toys"],
        platforms: ["youtube"],
      },
      {
        id: "tt_cosmetics",
        title: "TT Cosmetics",
        hook: "Смотри эффект",
        format: "ugc",
        retention: "proof",
        op_score: 84,
        confidence: "medium",
        final_decision: "control",
        niches: ["ru_cosmetics"],
        platforms: ["tiktok"],
      },
    ],
    limit: 2,
    segmentPriorityQueue: [
      {
        niche: "ru_cosmetics",
        platform: "tiktok",
        decision_priority_score: 96,
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
  testBuildHypothesisBankRanksDecisionAndFeedback();
  testGroupedHypothesisBanksSplitByNicheAndPlatform();
  testHypothesisBankPrioritizesHighPayoffSegment();
  testGroupedHypothesisBanksSortBySegmentPriority();
  console.log("reelsBrainHypothesisBank.test: ok");
}

run();
