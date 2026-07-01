import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReelsBrainFeedbackLoop,
  buildReelsBrainOperatingSystem,
} from "./reelsBrainOperatingSystem";

test("feedback loop classifies market winners and losers", () => {
  const feedback = buildReelsBrainFeedbackLoop([
    { recipe_id: 1, platform: "Instagram", views: 25000, completion_rate: 0.52, saves: 80, marketplace_orders: 3, revenue: 1200 },
    { recipe_id: 2, platform: "TikTok", views: 400, completion_rate: 0.12, ctr_card: 0.002 },
  ]);

  assert.equal(feedback.status, "live");
  assert.equal(feedback.total_posts, 2);
  assert.equal(feedback.winners, 1);
  assert.equal(feedback.losers, 1);
  assert.equal(feedback.total_orders, 3);
  assert.equal(feedback.by_platform[0].platform, "instagram");
});

test("operating system builds product audience experiment and portfolio layers", () => {
  const os = buildReelsBrainOperatingSystem({
    feedbackRows: [{ recipe_id: 1, platform: "youtube", views: 12000, saves: 60 }],
    insights: {
      top_hooks: [{ hook_label: "Не покупай пока не увидишь тест", op_score: 91 }],
      winning_formats: [{ label: "распаковка", avg_score: 88, frequency: 7 }],
      retention_mechanics: [{ label: "ожидание доказательства", avg_score: 82 }],
    },
    patterns: [
      {
        title: "демо / обзор: распаковка",
        hook: "Проверяю игрушку на камеру",
        format: "распаковка",
        retention: "ожидание доказательства",
        niches: ["ru_toys"],
        creative_brief: {
          product_fit: ["детский подарок"],
          visual_recipe: ["крупный proof-кадр товара"],
          second_by_second: ["0-2с хук"],
        },
      },
    ],
  });

  assert.equal(os.feedback_loop.status, "live");
  assert.equal(os.audio_visual_intelligence.status, "rule_based_live");
  assert.equal(os.product_brain.status, "seeded");
  assert.equal(os.audience_brain.status, "seeded");
  assert.equal(os.experiment_brain.status, "ready_to_plan");
  assert.equal(os.portfolio_manager.learning_input, "live");
});
