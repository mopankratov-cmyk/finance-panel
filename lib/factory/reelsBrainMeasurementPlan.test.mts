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
});

assert.equal(plan.status, "ready");
assert.equal(plan.items[0]?.task_type, "prove_exact_segment");
assert.equal(plan.items[0]?.niche, "ru_clothing");
assert.equal(plan.items[0]?.platform, "instagram");
assert.equal(plan.items[0]?.policy_mode, "primary");
assert.match(plan.items[0]?.action || "", /exact-proof run/);
assert.equal(plan.items[1]?.pattern_id, "p1");
assert.equal(plan.items[1]?.niche, "ru_toys");
assert.equal(plan.items[1]?.platform, "tiktok");
assert.equal(plan.items[1]?.policy_mode, "control_only");
assert.equal(plan.items[1]?.publish_brief.hook, "Не покупай пока не увидишь");
assert.match(plan.items[1]?.action || "", /measurement-run/);
assert.equal(plan.items[1]?.endpoints.feedback_writeback, "/api/factory/reels-brain/feedback");
assert.equal(plan.exact_gap_candidates, 1);

console.log("reelsBrainMeasurementPlan.test: ok");
