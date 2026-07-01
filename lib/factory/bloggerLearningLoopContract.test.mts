import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildKatyaLearningLoop } from "./bloggerLearningLoop";

{
  const plan = buildKatyaLearningLoop({
    blogger_id: "katya_russian_creator_v3b",
    target_runs: 100,
    generation_size: 12,
  });
  equal(plan.ok, true, "Katya learning loop builds");
  equal(plan.mode, "katya-blogger-learning-loop", "mode is explicit");
  equal(plan.target_runs, 100, "default target can plan 100 runs");
  equal(plan.generation_size, 12, "generation size is preserved");
  equal(plan.generation_count, 9, "100 runs are split into reviewable generations");
  equal(plan.planned_runs.length, 100, "100 dry-run render candidates are planned");
  ok(plan.planned_runs.every((run) => run.blogger_id === "katya_russian_creator_v3b"), "all runs stay on Katya");
  ok(plan.planned_runs.every((run) => run.avatar_look_id), "all runs carry avatar look id");
  ok(plan.planned_runs.every((run) => run.voice_id), "all runs carry voice id");
  ok(plan.planned_runs.every((run) => /no product, no b-roll/i.test(run.heygen_visual_prompt)), "visual prompts explicitly block product and b-roll");
  ok(plan.planned_runs.some((run) => run.scene_id !== plan.planned_runs[0].scene_id), "scene varies");
  ok(plan.planned_runs.some((run) => run.camera_angle_id !== plan.planned_runs[0].camera_angle_id), "camera angle varies");
  ok(plan.planned_runs.some((run) => run.pose_id !== plan.planned_runs[0].pose_id), "pose varies");
  ok(plan.planned_runs.some((run) => run.motion_preset !== plan.planned_runs[0].motion_preset), "motion varies");
}

{
  const plan = buildKatyaLearningLoop({
    target_runs: 12,
    generation_size: 6,
    prior_results: [
      {
        run_id: "winner-medium-skeptic",
        scores: {
          face_realism: 8,
          motion_realism: 8,
          lip_sync: 7,
          voice_naturalness: 7,
          room_authenticity: 8,
          anti_ai_first_2s: 8,
          repeatability_penalty: 2,
        },
      },
      {
        run_id: "bad-high-smile",
        scores: {
          face_realism: 5,
          motion_realism: 4,
          lip_sync: 6,
          voice_naturalness: 6,
          room_authenticity: 6,
          anti_ai_first_2s: 4,
          repeatability_penalty: 8,
        },
        fail_reasons: ["presenter smile"],
      },
    ],
  });
  ok(plan.promote.includes("winner-medium-skeptic"), "strong prior result is promoted");
  ok(plan.demote.includes("bad-high-smile"), "weak prior result is demoted");
  equal(plan.prior_evaluations.length, 2, "prior results are converted to scorecards");
}

{
  const route = readFileSync("app/api/factory/blogger-learning-loop/route.ts", "utf8");
  ok(/Dry-run only/.test(route), "route declares dry-run behavior");
  ok(!/heygenCreateVideo/.test(route), "learning loop route does not render paid video");
  ok(!/confirmPaid/.test(route), "learning loop route cannot bypass paid guard");
}

{
  const source = readFileSync("lib/factory/bloggerLearningLoop.ts", "utf8");
  ok(/target_runs/.test(source), "loop exposes target run count");
  ok(/generation_size/.test(source), "loop exposes generation size");
  ok(/no product, no b-roll/.test(source), "loop explicitly excludes product and b-roll");
}

console.log("bloggerLearningLoopContract: passed");
