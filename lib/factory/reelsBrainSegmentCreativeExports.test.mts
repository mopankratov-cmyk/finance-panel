import assert from "node:assert/strict";
import { buildReelsBrainSegmentCreativeExports } from "./reelsBrainSegmentCreativeExports";

function testBuildReelsBrainSegmentCreativeExportsSplitsShipAndValidateLanes() {
  const result = buildReelsBrainSegmentCreativeExports({
    segmentGenerationPacks: {
      items: [
        {
          niche: "ru_toys",
          platform: "tiktok",
          label: "ru_toys × tiktok",
          readiness_score: 94,
          ready_for_generation: true,
          quality_gate: { status: "ready", allowed_generation_modes: ["decision_ready"], blocked_reasons: [] },
          payload: {
            hook: "Смотри что внутри",
            retention: "payoff",
            structure: "demo",
            visual_recipe: ["macro reveal"],
            audio_strategy: ["fast ugc voice"],
            product_fit: ["toys"],
            copy_as_mechanic: ["tempo"],
            do_not_copy: ["music"],
          },
          brief_title: "Toys brief",
          action_title: "Scale toys",
          action_decision: "scale",
          action_success_metric: "Hold baseline",
          action_guardrails: ["Не копировать текст"],
          hypothesis_title: "Reveal hypothesis",
          hypothesis_text: "Reveal first should lift hold",
          evidence_status: "high_trust",
          corpus_score: 90,
          market_score: 78,
          stable_pattern_count: 4,
          evidence_refs: 4,
        },
        {
          niche: "ru_cosmetics",
          platform: "instagram",
          label: "ru_cosmetics × instagram",
          readiness_score: 71,
          ready_for_generation: true,
          quality_gate: { status: "needs_validation", allowed_generation_modes: ["control_ready"], blocked_reasons: ["trust score ниже decision-grade порога"] },
          outcome_status: "weak",
          outcome_confidence: "medium",
          outcome_posts: 3,
          outcome_winners: 0,
          outcome_losers: 2,
          outcome_trust_action: "review_or_penalize_segment",
          outcome_evidence: "0 winners / 3 posts",
          payload: {
            hook: "До и после",
            retention: "proof frame",
            structure: "ugc",
          },
          brief_title: "Beauty brief",
          action_title: "Validate beauty",
          action_decision: "control",
          hypothesis_title: "Proof hypothesis",
          hypothesis_text: "Before/after should beat plain review",
          evidence_status: "validated",
          corpus_score: 66,
          market_score: 42,
          stable_pattern_count: 1,
          evidence_refs: 1,
        },
      ],
    },
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.ship, 1);
  assert.equal(result.summary.validate, 1);
  assert.equal(result.ship_now[0]?.brief.title, "Toys brief");
  assert.equal(result.validate_next[0]?.content_solution.action_decision, "control");
  assert.equal(result.items[0]?.generator_bundle.lane, "ship");
  assert.equal(result.items[1]?.generator_bundle.blocked_reasons[0], "trust score ниже decision-grade порога");
  assert.ok(result.items[1]?.content_solution.guardrails.some((item: string) => item.includes("Не пускать текущую механику")));
  assert.ok(result.items[1]?.brief.do_not_copy.some((item: string) => item.includes("weak")));
  assert.equal(result.items[1]?.trust.outcome_anti_patterns?.[0]?.label, "Weak segment outcome");
  assert.equal(result.items[0]?.trust.proof_quality, "untraced");
}

function run() {
  testBuildReelsBrainSegmentCreativeExportsSplitsShipAndValidateLanes();
  console.log("reelsBrainSegmentCreativeExports.test: ok");
}

run();
