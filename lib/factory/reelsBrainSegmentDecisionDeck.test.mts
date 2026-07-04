import assert from "node:assert/strict";
import { buildReelsBrainSegmentDecisionDeck } from "./reelsBrainSegmentDecisionDeck";

function testBuildReelsBrainSegmentDecisionDeckRanksDecisionReadySegments() {
  const result = buildReelsBrainSegmentDecisionDeck({
    segmentOutputBanks: {
      briefs: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          recommended_mode: "primary",
          trust_score: 91,
          primary_allowed: true,
          primary: {
            title: "Toys TikTok brief",
            confidence: "high",
            evidence: { references: 4 },
            creative_brief: {
              hook: "Смотри что внутри",
              retention_mechanic: "быстрый payoff",
              visual_recipe: ["macro reveal"],
              audio_strategy: ["fast ugc voice"],
              product_fit: ["toys"],
              copy_as_mechanic: ["tempo"],
              do_not_copy: ["music"],
            },
          },
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          recommended_mode: "control_only",
          trust_score: 63,
          primary: {
            title: "Beauty IG brief",
            confidence: "medium",
            evidence: { references: 2 },
            creative_brief: {
              hook: "До и после",
              retention_mechanic: "proof frame",
            },
          },
        },
      ],
      actions: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          primary: {
            title: "Scale toys TikTok",
            decision: "scale",
            priority_score: 94,
            success_metric: "Hold the winner baseline",
            guardrails: ["Не копировать текст"],
            brief_seed: { structure: "demo" },
          },
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          primary: {
            title: "Validate beauty IG",
            decision: "control",
            priority_score: 71,
            brief_seed: { structure: "ugc" },
          },
        },
      ],
      hypotheses: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          cards: [
            {
              title: "Reveal hypothesis",
              hypothesis: "Reveal first should lift hold",
              priority_score: 89,
              success_metric: "Improve retention",
            },
          ],
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          cards: [
            {
              title: "Proof frame hypothesis",
              hypothesis: "Before/after should beat plain review",
              priority_score: 68,
            },
          ],
        },
      ],
    },
    segmentPlaybook: {
      items: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          status: "ship_now",
          recommended_mode: "primary",
          opportunity_score: 92,
          stability_score: 88,
          stable_pattern_count: 4,
          rollout: { why_now: "strong", next_step: "publish" },
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          status: "validate_and_ship",
          recommended_mode: "control_only",
          opportunity_score: 74,
          stability_score: 69,
          stable_pattern_count: 2,
          rollout: { why_now: "good signal", next_step: "control test" },
        },
      ],
    },
    evidenceLedger: {
      items: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          evidence_status: "high_trust",
          corpus_score: 90,
          market_score: 88,
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          evidence_status: "validated",
          corpus_score: 72,
          market_score: 62,
        },
      ],
    },
    patternAtlas: {
      by_segment: [
        { niche: "ru_toys", platform: "tiktok", status: "stable", stable_pattern_count: 4, analyzed_videos: 88 },
        { niche: "ru_cosmetics", platform: "instagram", status: "forming", stable_pattern_count: 2, analyzed_videos: 34 },
      ],
    },
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.ship, 1);
  assert.equal(result.summary.validate, 1);
  assert.equal(result.summary.ready_for_generation, 2);
  assert.equal(result.items[0]?.niche, "ru_toys");
  assert.equal(result.items[0]?.decision_grade, "ship");
  assert.equal(result.items[0]?.generation_mode, "decision_ready");
  assert.equal(result.items[0]?.generator_payload.structure, "demo");
  assert.equal(result.items[1]?.decision_grade, "validate");
  assert.equal(result.items[1]?.generation_mode, "control_ready");
}

function run() {
  testBuildReelsBrainSegmentDecisionDeckRanksDecisionReadySegments();
  console.log("reelsBrainSegmentDecisionDeck.test: ok");
}

run();
