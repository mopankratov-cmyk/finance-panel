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
        {
          niche: "ru_clothing",
          platform: "instagram",
          recommended_mode: "primary",
          trust_score: 86,
          primary: {
            title: "Clothing IG brief",
            confidence: "high",
            evidence: { references: 3 },
            creative_brief: {
              hook: "Смотри как сидит",
              retention_mechanic: "outfit switch",
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
        {
          niche: "ru_clothing",
          platform: "instagram",
          primary: {
            title: "Validate clothing IG",
            decision: "control",
            priority_score: 82,
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
        {
          niche: "ru_clothing",
          platform: "instagram",
          cards: [
            {
              title: "Try-on proof hypothesis",
              hypothesis: "Fast try-on should beat static mirror shot",
              priority_score: 78,
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
        {
          niche: "ru_clothing",
          platform: "instagram",
          status: "validate_and_ship",
          recommended_mode: "primary",
          opportunity_score: 83,
          stability_score: 77,
          stable_pattern_count: 3,
          rollout: { why_now: "strong corpus", next_step: "prove exact segment" },
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
          proof_quality: "exact_segment",
          exact_segment_posts: 2,
          traced_posts: 4,
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          evidence_status: "validated",
          corpus_score: 72,
          market_score: 62,
        },
        {
          niche: "ru_clothing",
          platform: "instagram",
          evidence_status: "validated",
          corpus_score: 84,
          market_score: 76,
          proof_quality: "traced_transfer_only",
          traced_posts: 3,
          exact_segment_posts: 0,
        },
      ],
    },
    patternAtlas: {
      by_segment: [
        { niche: "ru_toys", platform: "tiktok", status: "stable", stable_pattern_count: 4, analyzed_videos: 88 },
        { niche: "ru_cosmetics", platform: "instagram", status: "forming", stable_pattern_count: 2, analyzed_videos: 34 },
        { niche: "ru_clothing", platform: "instagram", status: "stable", stable_pattern_count: 3, analyzed_videos: 57 },
      ],
    },
    feedbackLoop: {
      by_segment: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          segment: "ru_toys × tiktok",
          posts: 6,
          winners: 3,
          losers: 0,
          status: "proven",
          trust_action: "promote_segment_trust",
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          segment: "ru_cosmetics × instagram",
          posts: 3,
          winners: 0,
          losers: 2,
          status: "weak",
          trust_action: "review_or_penalize_segment",
        },
        {
          niche: "ru_clothing",
          platform: "instagram",
          segment: "ru_clothing × instagram",
          posts: 4,
          winners: 2,
          losers: 0,
          status: "proven",
          proof_quality: "traced_transfer_only",
          traced_posts: 3,
          exact_segment_posts: 0,
          trust_action: "keep_validating_segment",
        },
      ],
      segment_outcome_memory: {
        trust_update_queue: [
          {
            segment: "ru_toys × tiktok",
            trust_action: "promote_segment_trust",
            evidence: "3 winners / 6 posts",
          },
          {
            segment: "ru_cosmetics × instagram",
            trust_action: "review_or_penalize_segment",
            evidence: "0 winners / 3 posts",
          },
          {
            segment: "ru_clothing × instagram",
            trust_action: "keep_validating_segment",
            evidence: "2 winners / 4 posts · exact 0 · traced 3",
          },
        ],
      },
    },
  });

  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.ship, 1);
  assert.equal(result.summary.validate, 1);
  assert.equal(result.summary.research, 1);
  assert.equal(result.summary.ready_for_generation, 2);
  assert.equal(result.summary.proven_outcomes, 2);
  assert.equal(result.summary.weak_outcomes, 1);
  assert.equal(result.summary.exact_proof_ready, 1);
  assert.equal(result.items[0]?.niche, "ru_toys");
  assert.equal(result.items[0]?.decision_grade, "ship");
  assert.equal(result.items[0]?.generation_mode, "decision_ready");
  assert.equal(result.items[0]?.outcome_status, "proven");
  assert.equal(result.items[0]?.proof_quality, "exact_segment");
  assert.equal(result.items[0]?.outcome_confidence, "high");
  assert.equal(result.items[0]?.generator_payload.structure, "demo");
  const clothing = result.items.find((item) => item.niche === "ru_clothing");
  assert.equal(clothing?.decision_grade, "validate");
  assert.equal(clothing?.generation_mode, "control_ready");
  assert.equal(clothing?.ready_for_generation, true);
  assert.equal(clothing?.proof_quality, "traced_transfer_only");
  assert.match(clothing?.next_step || "", /exact-segment proof/i);
  const cosmetics = result.items.find((item) => item.niche === "ru_cosmetics");
  assert.equal(cosmetics?.decision_grade, "research");
  assert.equal(cosmetics?.generation_mode, "research_only");
  assert.equal(cosmetics?.ready_for_generation, false);
  assert.equal(cosmetics?.outcome_status, "weak");
}

function run() {
  testBuildReelsBrainSegmentDecisionDeckRanksDecisionReadySegments();
  console.log("reelsBrainSegmentDecisionDeck.test: ok");
}

run();
