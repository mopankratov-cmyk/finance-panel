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
          proof_quality: "exact_segment",
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
  assert.equal(result.items[0]?.trust.proof_quality, "exact_segment");
  assert.equal(result.items[0]?.trust.exact_segment_ready, true);
  assert.equal(result.items[0]?.generator_bundle.exact_segment_ready, true);
  assert.equal(result.items[0]?.publishable_exact, true);
}

function testSegmentCreativeExportsPrioritizeHighPayoffSegment() {
  const result = buildReelsBrainSegmentCreativeExports({
    segmentGenerationPacks: {
      items: [
        {
          niche: "ru_toys",
          platform: "youtube",
          label: "ru_toys × youtube",
          readiness_score: 96,
          ready_for_generation: true,
          quality_gate: { status: "ready", allowed_generation_modes: ["decision_ready"], blocked_reasons: [] },
          proof_quality: "exact_segment",
          payload: { hook: "hook y", retention: "proof", structure: "demo" },
          brief_title: "YT brief",
          action_title: "Scale yt",
          action_decision: "scale",
          hypothesis_title: "YT hypothesis",
          hypothesis_text: "yt",
          segment_priority_score: 41,
          segment_priority_mode: "research_only",
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          label: "ru_cosmetics × tiktok",
          readiness_score: 75,
          ready_for_generation: true,
          quality_gate: { status: "needs_validation", allowed_generation_modes: ["control_ready"], blocked_reasons: [] },
          proof_quality: "traced_transfer_only",
          payload: { hook: "hook t", retention: "ugc proof", structure: "ugc" },
          brief_title: "TT brief",
          action_title: "Validate tt",
          action_decision: "control",
          hypothesis_title: "TT hypothesis",
          hypothesis_text: "tt",
          segment_priority_score: 97,
          segment_priority_mode: "primary",
          segment_ready_for_generation: true,
          projected_trust_gain_score: 24,
          projected_production_state: "decision_ready",
          unlocked_output: "creative exports",
        },
      ],
    },
  });

  assert.equal(result.items[0]?.niche, "ru_cosmetics");
  assert.equal(result.items[0]?.platform, "tiktok");
  assert.equal(result.items[0]?.segment_priority_mode, "primary");
  assert.equal(result.summary.primary_priority_segments, 1);
}

function run() {
  testBuildReelsBrainSegmentCreativeExportsSplitsShipAndValidateLanes();
  testSegmentCreativeExportsPrioritizeHighPayoffSegment();
  console.log("reelsBrainSegmentCreativeExports.test: ok");
}

run();
