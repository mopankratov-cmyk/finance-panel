import assert from "node:assert/strict";
import test from "node:test";
import { buildReelsBrainSchedulerPlan } from "./reelsBrainScheduler";

test("reels brain scheduler builds bulk analyze daily and weekly tasks", () => {
  const plan = buildReelsBrainSchedulerPlan({
    niches: "ru_toys,ru_clothing",
    platforms: "tiktok,youtube",
  });

  assert.deepEqual(plan.niches, ["ru_toys", "ru_clothing"]);
  assert.deepEqual(plan.platforms, ["tiktok", "youtube"]);
  assert.deepEqual(plan.tasks.map((task) => task.task), ["bulk", "daily", "analyze", "weekly"]);
  assert.equal(plan.tasks[0].endpoint, "/api/factory/jobs/reels-brain-autopilot");
  assert.equal(plan.tasks[2].endpoint, "/api/factory/jobs/reels-brain-analyze-backlog");
  assert.equal(plan.tasks[2].payload.max_lanes, 3);
  assert.equal(plan.tasks[2].payload.limit, 8);
  assert.equal(plan.tasks[2].payload.build_patterns, false);
  assert.equal(plan.tasks[0].payload.target, 10000);
  assert.equal(plan.tasks[0].payload.max_backlog_before_analyze, 180);
});
