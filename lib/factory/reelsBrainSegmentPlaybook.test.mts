import assert from "node:assert/strict";
import { buildReelsBrainSegmentPlaybook } from "./reelsBrainSegmentPlaybook";

function testBuildReelsBrainSegmentPlaybookRanksReadySegments() {
  const result = buildReelsBrainSegmentPlaybook({
    opportunities: {
      top: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          opportunity_score: 91,
          status: "scale_now",
          recommended_mode: "primary",
          best_brief_title: "Toys TikTok brief",
          best_brief_hook: "Смотри что внутри",
          best_action_title: "Scale toys TikTok",
          best_hypothesis_title: "Fast demo hypothesis",
          best_hypothesis: "Если начать с reveal, удержание вырастет",
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          opportunity_score: 61,
          status: "build_next",
          recommended_mode: "control_only",
          best_brief_title: "Cosmetics IG brief",
          best_action_title: "Validate cosmetics IG",
        },
      ],
    },
    patternAtlas: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          status: "stable",
          recommended_mode: "primary",
          avg_stability_score: 86,
          stable_pattern_count: 4,
          analyzed_videos: 88,
          total_videos: 110,
          next_step: "Можно собирать platform-specific briefs.",
          top_patterns: [
            {
              title: "Fast demo surprise",
              hook: "Смотри что внутри",
              retention: "быстрый payoff",
              format: "demo",
              final_decision: "scale",
              market_status: "proven",
              stability_score: 93,
              brief_seed: {
                hook: "Смотри что внутри",
                retention: "быстрый payoff",
                visual_recipe: ["macro reveal"],
                audio_strategy: ["fast ugc"],
              },
            },
          ],
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          status: "forming",
          recommended_mode: "control_only",
          avg_stability_score: 64,
          stable_pattern_count: 1,
          analyzed_videos: 27,
          total_videos: 55,
          next_step: "Нужен ещё один цикл анализа.",
          top_patterns: [
            {
              title: "Proof before after",
              hook: "Смотри до и после",
              retention: "proof frame",
              format: "ugc",
              final_decision: "control",
              market_status: "promising",
              stability_score: 67,
            },
          ],
        },
      ],
    },
    limit: 6,
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.ship_now, 1);
  assert.equal(result.items[0]?.status, "ship_now");
  assert.equal(result.items[0]?.niche, "ru_toys");
  assert.equal(result.items[0]?.platform, "tiktok");
  assert.equal(result.items[0]?.brief.title, "Toys TikTok brief");
  assert.equal(result.items[0]?.leading_pattern.title, "Fast demo surprise");
  assert.equal(result.items[1]?.status, "validate_and_ship");
}

function run() {
  testBuildReelsBrainSegmentPlaybookRanksReadySegments();
  console.log("reelsBrainSegmentPlaybook.test: ok");
}

run();
