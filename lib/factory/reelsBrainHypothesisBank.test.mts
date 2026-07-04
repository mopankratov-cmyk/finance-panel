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

function run() {
  testBuildHypothesisBankRanksDecisionAndFeedback();
  testGroupedHypothesisBanksSplitByNicheAndPlatform();
  console.log("reelsBrainHypothesisBank.test: ok");
}

run();
