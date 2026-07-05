import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainSegmentSolutions } from "./reelsBrainSegmentSolutions";

test("buildReelsBrainSegmentSolutions maps decision snapshot into operator-ready solutions", () => {
  const result = buildReelsBrainSegmentSolutions({
    decisionSnapshot: {
      summary: { filtered_total: 2 },
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          lane: "ship",
          label: "ru_toys × instagram",
          readiness_score: 91,
          high_trust_generation_ready: true,
          publishable_exact: true,
          trust: {
            corpus_score: 86,
            market_score: 71,
            stable_pattern_count: 4,
            evidence_refs: 5,
            proof_quality: "exact_segment",
            outcome_status: "proven",
            outcome_confidence: "high",
            outcome_posts: 6,
            outcome_winners: 3,
            outcome_losers: 0,
            outcome_trust_action: "promote_segment_trust",
            outcome_evidence: "3 winners / 6 posts",
          },
          brief: {
            title: "UGC reveal",
            hook: "Смотри что внутри",
            retention: "open loop",
            structure: "before_after",
            second_by_second: ["0-2 hook", "2-5 reveal"],
            visual_recipe: ["macro", "hands", "packaging"],
            audio_strategy: ["fast voice", "light bed"],
            product_fit: ["toys"],
            copy_as_mechanic: ["reveal timing"],
            do_not_copy: ["original text"],
          },
          hypothesis: {
            title: "Reveal beats static demo",
            text: "Если показать распаковку сразу, retention вырастет.",
            success_metric: "higher hold rate",
          },
          content_solution: {
            action_title: "Launch reveal series",
            action_decision: "scale",
            success_metric: "retain 3s hold",
            guardrails: ["no direct copy"],
            execution_note: "ship it",
          },
          upgrade_forecast: {
            unlocked_output: "publishable_visual_brief",
            projected_production_state: "publishable_exact",
            projected_trust_gain_score: 26,
            projected_trust_gain_band: "high",
            recommended_loop: "media_backfill",
            unlocked_next_step: "После закрытия visual-gap сегмент станет publishable exact.",
          },
          next_step: "Снять 3 вариации",
          audit: {
            verdict: "ship",
            strong_signals: ["trust score уже проходит gate"],
            blockers: [],
          },
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          lane: "research",
          readiness_score: 44,
          brief: { hook: "До/после за 5 сек" },
          trust: {
            proof_quality: "traced_transfer_only",
            outcome_status: "weak",
            outcome_confidence: "medium",
            outcome_posts: 3,
            outcome_winners: 0,
            outcome_losers: 2,
            outcome_trust_action: "review_or_penalize_segment",
            outcome_evidence: "0 winners / 3 posts",
          },
          hypothesis: { text: "Нужен более сильный social proof" },
          content_solution: { action_title: "Hold in research" },
          audit: {
            verdict: "research",
            strong_signals: [],
            blockers: ["мало stable patterns"],
          },
        },
      ],
    },
  });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.ready_now, 1);
  assert.equal(result.summary.generation_ready, 1);
  assert.equal(result.summary.publishable_exact, 1);
  assert.equal(result.items[0]?.production_state, "ready_now");
  assert.equal(result.items[0]?.high_trust_generation_ready, true);
  assert.equal(result.items[0]?.publishable_exact, true);
  assert.equal(result.items[0]?.trust_band, "high");
  assert.equal(result.items[0]?.trust_summary.evidence_band, "stable");
  assert.equal(result.items[0]?.trust_summary.high_trust_generation_ready, true);
  assert.equal(result.items[0]?.trust_summary.proof_quality, "exact_segment");
  assert.equal(result.items[0]?.trust_summary.outcome_status, "proven");
  assert.equal(result.items[0]?.trust_summary.outcome_winners, 3);
  assert.equal(result.items[0]?.recommended_upgrade?.unlocked_output, "publishable_visual_brief");
  assert.equal(result.items[0]?.content_decision.recommended_upgrade?.projected_trust_gain_score, 26);
  assert.deepEqual(result.items[0]?.creative_brief.second_by_second, ["0-2 hook", "2-5 reveal"]);
  assert.equal(result.items[1]?.production_state, "research_only");
  assert.equal(result.items[1]?.trust_summary.proof_quality, "traced_transfer_only");
  assert.equal(result.items[1]?.trust_summary.outcome_status, "weak");
  assert.equal(result.items[1]?.trust_summary.outcome_losers, 2);
  assert.ok(result.items[1]?.trust_summary.blockers.includes("trust floor below 85"));
  assert.ok(result.items[1]?.trust_summary.blockers.includes("fewer than 3 stable patterns"));
});

test("buildReelsBrainSegmentSolutions keeps lane buckets", () => {
  const result = buildReelsBrainSegmentSolutions({
    decisionSnapshot: {
      items: [
        {
          niche: "ru_toys",
          platform: "instagram",
          lane: "ship",
          readiness_score: 90,
          trust: { corpus_score: 90, market_score: 70, stable_pattern_count: 4, evidence_refs: 4 },
          brief: { hook: "A" },
          content_solution: { action_title: "A" },
          audit: { verdict: "ship" },
        },
        {
          niche: "ru_toys",
          platform: "youtube",
          lane: "validate",
          readiness_score: 69,
          trust: { corpus_score: 70, market_score: 56, stable_pattern_count: 2, evidence_refs: 2 },
          brief: { hook: "B" },
          content_solution: { action_title: "B" },
          audit: { verdict: "validate" },
        },
        {
          niche: "ru_toys",
          platform: "tiktok",
          lane: "research",
          readiness_score: 42,
          trust: { corpus_score: 42, market_score: 21, stable_pattern_count: 1, evidence_refs: 1 },
          brief: { hook: "C" },
          content_solution: { action_title: "C" },
          audit: { verdict: "research" },
        },
      ],
    },
  });

  assert.equal(result.ship_now.length, 1);
  assert.equal(result.validate_next.length, 1);
  assert.equal(result.research_queue.length, 1);
});

test("buildReelsBrainSegmentSolutions prioritizes high-payoff segment", () => {
  const result = buildReelsBrainSegmentSolutions({
    decisionSnapshot: {
      items: [
        {
          niche: "ru_toys",
          platform: "youtube",
          lane: "ship",
          readiness_score: 94,
          trust: { corpus_score: 88, market_score: 72, stable_pattern_count: 4, evidence_refs: 4, proof_quality: "exact_segment" },
          brief: { hook: "A" },
          content_solution: { action_title: "A" },
          audit: { verdict: "ship" },
          segment_priority_score: 40,
          segment_priority_mode: "research_only",
        },
        {
          niche: "ru_cosmetics",
          platform: "tiktok",
          lane: "validate",
          readiness_score: 71,
          high_trust_generation_ready: true,
          publishable_exact: true,
          trust: { corpus_score: 70, market_score: 56, stable_pattern_count: 2, evidence_refs: 2, proof_quality: "traced_transfer_only" },
          brief: { hook: "B" },
          content_solution: { action_title: "B" },
          audit: { verdict: "validate" },
          segment_priority_score: 96,
          segment_priority_mode: "primary",
          segment_ready_for_generation: true,
        },
      ],
    },
  });

  assert.equal(result.items[0]?.platform, "tiktok");
  assert.equal(result.items[0]?.segment_priority_mode, "primary");
  assert.equal(result.items[0]?.high_trust_generation_ready, true);
  assert.equal(result.summary.primary_priority_segments, 1);
});
