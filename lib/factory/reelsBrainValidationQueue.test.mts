import assert from "node:assert/strict";
import { buildReelsBrainValidationQueue } from "./reelsBrainValidationQueue";

const queue = buildReelsBrainValidationQueue({
  measurementPlan: {
    coverage_rate: 61,
    high_confidence_no_feedback: 2,
    total_candidates: 3,
    items: [
      {
        measurement_id: "m1",
        pattern_id: "p1",
        title: "Proof opener",
        niche: "ru_toys",
        platform: "tiktok",
        policy_mode: "control_only",
        decision_priority_score: 91,
        action: "Сделать measurement-run для Proof opener на ru_toys × tiktok",
        validation_goal: "Проверить паттерн в controlled batch до повышения trust.",
        publish_brief: {
          hook: "Не покупай пока не увидишь",
          retention: "proof first",
          structure: "demo",
          next_step: "Собрать 3 публикации и сравнить completion.",
        },
        metrics_to_capture: ["views", "watch_rate", "completion_rate"],
        endpoints: {
          feedback_writeback: "/api/factory/reels-brain/feedback",
          post_metrics: "/api/factory/post-metrics",
        },
      },
    ],
  },
});

assert.equal(queue.status, "ready");
assert.equal(queue.queue[0]?.type, "validate_pattern_feedback");
assert.equal(queue.queue[0]?.priority, "high");
assert.equal(queue.queue[0]?.writeback_targets.feedback, "/api/factory/reels-brain/feedback");
assert.equal(queue.queue[0]?.task_payload.pattern_id, "p1");
assert.match(queue.next_step, /validation-run/);

console.log("reelsBrainValidationQueue.test: ok");
