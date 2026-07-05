import assert from "node:assert/strict";
import { buildReelsBrainValidationRunbook } from "./reelsBrainValidationRunbook";

const runbook = buildReelsBrainValidationRunbook({
  validationQueue: {
    exact_gap_candidates: 2,
    queue: [
      {
        task_id: "exact__ru_toys__instagram",
        type: "prove_exact_segment",
        title: "ru_toys × instagram",
        niche: "ru_toys",
        platform: "instagram",
        policy_mode: "primary",
        segment_priority_score: 98,
        segment_priority_reason: "instagram exact segment has the highest current payoff",
        priority: "high",
        action: "Сделать exact-proof run для ru_toys × instagram",
        validation_goal: "Подтвердить, что exact segment работает сам.",
        publish_brief: {
          hook: "Новый exact hook",
          retention: "proof first",
          structure: "demo",
          next_step: "Снять 3 exact публикации.",
        },
        writeback_targets: {
          feedback: "/api/factory/reels-brain/feedback",
          post_metrics: "/api/factory/post-metrics",
        },
        task_payload: {
          proof_scope: "exact_segment",
        },
      },
    ],
  },
  measurementPlan: {
    items: [
      {
        measurement_id: "exact__ru_toys__instagram",
        endpoints: {
          creative_solution: "/api/factory/reels-brain/creative-solution?niche=ru_toys&platform=instagram",
        },
        recommended_upgrade: {
          unlocked_output: "publishable_exact_brief",
          projected_production_state: "publishable_exact",
          projected_trust_gain_score: 27,
          projected_trust_gain_band: "high",
          recommended_loop: "analyze_and_compact",
        },
      },
    ],
  },
});

assert.equal(runbook.status, "ready");
assert.equal(runbook.exact_gap_candidates, 2);
assert.equal(runbook.items[0]?.proof_scope, "exact_segment");
assert.equal(runbook.items[0]?.creative_solution_endpoint, "/api/factory/reels-brain/creative-solution?niche=ru_toys&platform=instagram");
assert.equal(runbook.items[0]?.feedback_payload_template.platform, "instagram");
assert.equal(runbook.items[0]?.feedback_payload_template.measurement_id, "exact__ru_toys__instagram");
assert.equal(runbook.items[0]?.feedback_payload_template.validation_task_id, "exact__ru_toys__instagram");
assert.equal(runbook.items[0]?.recommended_upgrade?.unlocked_output, "publishable_exact_brief");
assert.equal(runbook.items[0]?.recommended_upgrade?.projected_trust_gain_score, 27);
assert.equal(runbook.items[0]?.segment_priority_score, 98);
assert.match(runbook.items[0]?.segment_priority_reason || "", /highest current payoff/);
assert.match(runbook.items[0]?.publish_checklist[0] || "", /exact segment/i);

console.log("reelsBrainValidationRunbook: passed");
