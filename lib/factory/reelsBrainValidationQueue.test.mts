import assert from "node:assert/strict";
import { buildReelsBrainValidationQueue } from "./reelsBrainValidationQueue";

const queue = buildReelsBrainValidationQueue({
  measurementPlan: {
    coverage_rate: 61,
    high_confidence_no_feedback: 2,
    total_candidates: 3,
    exact_gap_candidates: 1,
    items: [
      {
        measurement_id: "exact_ru_toys_instagram",
        task_type: "prove_exact_segment",
        pattern_id: "",
        title: "ru_toys × instagram",
        niche: "ru_toys",
        platform: "instagram",
        policy_mode: "primary",
        decision_priority_score: 97,
        action: "Сделать exact-proof run для ru_toys × instagram",
        validation_goal: "Подтвердить, что exact segment работает сам, а не только через transfer-соседа.",
        publish_brief: {
          hook: "Новый exact hook",
          retention: "proof first",
          structure: "demo",
          next_step: "Снять 3 exact публикации и сравнить с transfer.",
        },
        metrics_to_capture: ["views", "watch_rate", "completion_rate"],
        endpoints: {
          feedback_writeback: "/api/factory/reels-brain/feedback",
          post_metrics: "/api/factory/post-metrics",
        },
        proof_scope: "exact_segment",
      },
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
        recommended_upgrade: {
          unlocked_output: "performance_tuned_brief",
          projected_production_state: "near_publishable",
          projected_trust_gain_score: 18,
          projected_trust_gain_band: "medium",
          recommended_loop: "audio_backfill",
        },
      },
      {
        measurement_id: "m2",
        pattern_id: "p2",
        title: "Visual payoff",
        niche: "ru_toys",
        platform: "instagram",
        policy_mode: "control_only",
        decision_priority_score: 89,
        action: "Сделать measurement-run для Visual payoff на ru_toys × instagram",
        validation_goal: "Проверить паттерн в controlled batch до повышения trust.",
        publish_brief: {
          hook: "Покажи результат сразу",
          retention: "visual payoff",
          structure: "demo",
          next_step: "Собрать 2 публикации и проверить saves.",
        },
        metrics_to_capture: ["views", "watch_rate", "saves"],
        endpoints: {
          feedback_writeback: "/api/factory/reels-brain/feedback",
          post_metrics: "/api/factory/post-metrics",
        },
        recommended_upgrade: {
          unlocked_output: "publishable_visual_brief",
          projected_production_state: "publishable_exact",
          projected_trust_gain_score: 31,
          projected_trust_gain_band: "high",
          recommended_loop: "media_backfill",
        },
      },
    ],
  },
});

assert.equal(queue.status, "ready");
assert.equal(queue.queue[0]?.type, "prove_exact_segment");
assert.equal(queue.queue[0]?.priority, "high");
assert.equal(queue.queue[0]?.writeback_targets.feedback, "/api/factory/reels-brain/feedback");
assert.equal(queue.queue[0]?.task_payload.proof_scope, "exact_segment");
assert.equal(queue.queue[1]?.task_payload.pattern_id, "p2");
assert.equal(queue.queue[1]?.recommended_upgrade?.projected_trust_gain_score, 31);
assert.equal(queue.queue[2]?.task_payload.pattern_id, "p1");
assert.match(queue.next_step, /prove_exact_segment/);

console.log("reelsBrainValidationQueue.test: ok");
