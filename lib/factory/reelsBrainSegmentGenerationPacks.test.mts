import assert from "node:assert/strict";
import { buildReelsBrainSegmentGenerationPacks } from "./reelsBrainSegmentGenerationPacks";

function testBuildReelsBrainSegmentGenerationPacksProducesQualityGatedPayloads() {
  const result = buildReelsBrainSegmentGenerationPacks({
    segmentDecisionDeck: {
      items: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          trust_score: 92,
          decision_grade: "ship",
          generation_mode: "decision_ready",
          ready_for_generation: true,
          evidence_status: "high_trust",
          corpus_score: 90,
          market_score: 81,
          stable_pattern_count: 4,
          brief: {
            title: "Toys brief",
            hook: "Смотри что внутри",
            retention: "payoff",
            second_by_second: ["0-2с hook", "2-6с reveal"],
            visual_recipe: ["macro reveal"],
            audio_strategy: ["fast ugc voice"],
            product_fit: ["toys"],
            copy_as_mechanic: ["tempo"],
            do_not_copy: ["music"],
            evidence_refs: 4,
          },
          action: {
            title: "Scale toys",
            decision: "scale",
            success_metric: "Hold the winner baseline",
            guardrails: ["Не копировать текст"],
            structure: "demo",
          },
          hypothesis: {
            title: "Reveal hypothesis",
            text: "Reveal first should lift hold",
          },
          generator_payload: {
            hook: "Смотри что внутри",
            retention: "payoff",
            structure: "demo",
            visual_recipe: ["macro reveal"],
            audio_strategy: ["fast ugc voice"],
            product_fit: ["toys"],
            copy_as_mechanic: ["tempo"],
            do_not_copy: ["music"],
          },
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          trust_score: 63,
          decision_grade: "validate",
          generation_mode: "control_ready",
          ready_for_generation: true,
          evidence_status: "validated",
          corpus_score: 66,
          market_score: 40,
          stable_pattern_count: 1,
          brief: {
            title: "Beauty brief",
            hook: "До и после",
            retention: "proof frame",
            evidence_refs: 1,
          },
          action: {
            title: "Validate beauty",
            decision: "control",
            structure: "ugc",
          },
          generator_payload: {
            hook: "До и после",
            retention: "proof frame",
            structure: "ugc",
          },
        },
      ],
    },
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.ready, 1);
  assert.equal(result.summary.needs_validation, 1);
  assert.equal(result.items[0]?.quality_gate.status, "ready");
  assert.equal(result.items[0]?.payload.structure, "demo");
  assert.equal(result.items[0]?.quality_gate.blocked_reasons.length, 0);
  assert.equal(result.items[1]?.quality_gate.status, "needs_validation");
  assert.ok(result.items[1]?.quality_gate.allowed_generation_modes.includes("control_ready"));
}

function run() {
  testBuildReelsBrainSegmentGenerationPacksProducesQualityGatedPayloads();
  console.log("reelsBrainSegmentGenerationPacks.test: ok");
}

run();
