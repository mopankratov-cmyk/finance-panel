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
      },
    ],
  },
});

assert.equal(runbook.status, "ready");
assert.equal(runbook.exact_gap_candidates, 2);
assert.equal(runbook.items[0]?.proof_scope, "exact_segment");
assert.equal(runbook.items[0]?.creative_solution_endpoint, "/api/factory/reels-brain/creative-solution?niche=ru_toys&platform=instagram");
assert.equal(runbook.items[0]?.feedback_payload_template.platform, "instagram");
assert.match(runbook.items[0]?.publish_checklist[0] || "", /exact segment/i);

console.log("reelsBrainValidationRunbook: passed");
