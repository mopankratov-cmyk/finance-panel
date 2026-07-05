import assert from "node:assert/strict";
import { buildReelsBrainMeasurementPlan } from "./reelsBrainMeasurementPlan";

const plan = buildReelsBrainMeasurementPlan({
  exactSegmentQueue: {
    items: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        status: "borrowed_brief_only",
        urgency_score: 95,
        policy_mode: "primary",
        transfer_support: [{ label: "ru_clothing × tiktok" }],
      },
    ],
  },
  outcomeMemory: {
    pattern_memory: {
      coverage_rate: 58,
      coverage_gaps: {
        high_confidence_no_feedback: 2,
      },
      no_feedback_queue: [
        {
          pattern_id: "p1",
          title: "Proof opener",
          quality_gate: "high_confidence",
          decision_priority_score: 91,
          hook_type: "warning_pattern_break",
          structure_type: "demo",
          niches: ["ru_toys"],
          platforms: ["tiktok"],
        },
      ],
    },
  },
  segmentSolutionMatrix: {
    by_segment: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        production_state: "controlled_test",
        readiness_score: 82,
        recommended_upgrade: {
          unlocked_output: "performance_tuned_brief",
          projected_production_state: "near_publishable",
          projected_trust_gain_score: 21,
          projected_trust_gain_band: "medium",
          recommended_loop: "audio_backfill",
          unlocked_next_step: "После аудио-добора сегмент станет retention-tuned.",
        },
        creative_brief: {
          hook: "Не покупай пока не увидишь",
          retention: "proof first",
          structure: "demo",
        },
        content_decision: {
          next_step: "Собрать 3 публикации и сравнить completion.",
        },
      },
    ],
  },
  generationPolicy: {
    by_segment: [
      {
        niche: "ru_toys",
        platform: "tiktok",
        policy_mode: "control_only",
        readiness_score: 82,
      },
    ],
  },
  segmentPriorityQueue: {
    items: [
      {
        niche: "ru_clothing",
        platform: "instagram",
        decision_priority_score: 98,
        policy_reason: "segment has the strongest exact-proof payoff",
      },
      {
        niche: "ru_toys",
        platform: "tiktok",
        decision_priority_score: 94,
        policy_reason: "segment is the best control-ready test lane",
      },
    ],
  },
});

assert.equal(plan.status, "ready");
assert.equal(plan.items[0]?.task_type, "prove_exact_segment");
assert.equal(plan.items[0]?.niche, "ru_clothing");
assert.equal(plan.items[0]?.platform, "instagram");
assert.equal(plan.items[0]?.policy_mode, "primary");
assert.equal(plan.items[0]?.decision_priority_score, 98);
assert.match(plan.items[0]?.action || "", /exact-proof run/);
assert.match(plan.items[0]?.reason || "", /strongest exact-proof payoff/);
assert.equal(plan.items[1]?.pattern_id, "p1");
assert.equal(plan.items[1]?.niche, "ru_toys");
assert.equal(plan.items[1]?.platform, "tiktok");
assert.equal(plan.items[1]?.policy_mode, "control_only");
assert.equal(plan.items[1]?.decision_priority_score, 100);
assert.equal(plan.items[1]?.publish_brief.hook, "Не покупай пока не увидишь");
assert.equal(plan.items[1]?.recommended_upgrade?.unlocked_output, "performance_tuned_brief");
assert.match(plan.items[1]?.reason || "", /upgrade performance_tuned_brief/);
assert.match(plan.items[1]?.reason || "", /best control-ready test lane/);
assert.match(plan.items[1]?.action || "", /measurement-run/);
assert.equal(plan.items[1]?.endpoints.feedback_writeback, "/api/factory/reels-brain/feedback");
assert.equal(plan.exact_gap_candidates, 1);

console.log("reelsBrainMeasurementPlan.test: ok");
