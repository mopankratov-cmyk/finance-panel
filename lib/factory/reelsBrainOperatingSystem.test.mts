import test from "node:test";
import assert from "node:assert/strict";
import { buildReelsBrainFeedbackLoop } from "./reelsBrainOperatingSystem";

test("buildReelsBrainFeedbackLoop aggregates segment outcome memory", () => {
  const result = buildReelsBrainFeedbackLoop([
    {
      recipe_id: 1,
      niche: "ru_toys",
      platform: "Tiktok",
      target_platform: "tiktok",
      segment_label: "ru_toys × tiktok",
      views: 22000,
      completion_rate: 0.51,
      ctr_card: 0.03,
      saves: 90,
      marketplace_orders: 3,
      revenue: 12000,
      measurement_id: "exact__ru_toys__tiktok",
      validation_task_id: "exact__ru_toys__tiktok",
      proof_scope: "exact_segment",
    },
    {
      recipe_id: 2,
      niche: "ru_toys",
      platform: "Tiktok",
      target_platform: "tiktok",
      segment_label: "ru_toys × tiktok",
      views: 14000,
      completion_rate: 0.46,
      ctr_card: 0.02,
      saves: 55,
      marketplace_orders: 1,
      revenue: 3000,
      measurement_id: "pattern__hook_demo",
      validation_task_id: "pattern__hook_demo",
      proof_scope: "pattern_feedback",
    },
    {
      recipe_id: 3,
      niche: "ru_cosmetics",
      platform: "Instagram",
      target_platform: "instagram",
      segment_label: "ru_cosmetics × instagram",
      views: 600,
      completion_rate: 0.12,
      ctr_card: 0.004,
      saves: 3,
      marketplace_orders: 0,
      revenue: 0,
    },
  ]);

  assert.equal(result.status, "live");
  assert.equal(result.segment_outcome_memory.ready, true);
  assert.equal(result.validation_trace.ready, true);
  assert.equal(result.validation_trace.traced_posts, 2);
  assert.equal(result.validation_trace.traced_coverage_rate, 67);
  assert.equal(result.validation_trace.exact_segment_posts, 1);
  assert.equal(result.validation_trace.pattern_feedback_posts, 1);
  assert.equal(result.validation_trace.by_proof_scope[0]?.proof_scope, "exact_segment");
  assert.equal(result.validation_trace.top_tasks[0]?.task_id, "exact__ru_toys__tiktok");
  assert.equal(result.by_segment[0]?.segment, "ru_toys × tiktok");
  assert.equal(result.by_segment[0]?.status, "proven");
  assert.equal(result.segment_outcome_memory.strongest_segments[0]?.segment, "ru_toys × tiktok");
  assert.equal(result.segment_outcome_memory.weak_segments[0]?.segment, "ru_cosmetics × instagram");
  assert.match(result.next_step, /segment trust/i);
});

console.log("reelsBrainOperatingSystem: passed");
