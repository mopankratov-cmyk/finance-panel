import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autoSelectKatyaGeneration } from "./bloggerLearningAutoSelect";
import { buildKatyaLearningLoop } from "./bloggerLearningLoop";

{
  const plan = buildKatyaLearningLoop({
    blogger_id: "katya_russian_creator_v3b",
    target_runs: 100,
    generation_size: 5,
  });
  equal(plan.ok, true, "Katya learning loop builds");
  equal(plan.mode, "katya-blogger-learning-loop", "mode is explicit");
  equal(plan.target_runs, 100, "default target can plan 100 runs");
  equal(plan.generation_size, 5, "generation size is preserved");
  equal(plan.generation_count, 20, "100 runs are split into small reviewable generations");
  equal(plan.planned_runs.length, 100, "100 dry-run render candidates are planned");
  ok(plan.planned_runs.every((run) => run.blogger_id === "katya_russian_creator_v3b"), "all runs stay on Katya");
  ok(plan.planned_runs.every((run) => run.avatar_look_id), "all runs carry avatar look id");
  ok(new Set(plan.planned_runs.map((run) => run.avatar_look_id)).size > 1, "scene planning can switch between multiple Katya source looks");
  ok(!plan.planned_runs.some((run) => run.avatar_look_label === "casual_home_reviewer"), "Katya loop excludes the known non-Katya reviewer look");
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
  const plan = buildKatyaLearningLoop({
    target_runs: 5,
    generation_size: 5,
    start_generation: 2,
    prior_results: [
      {
        run_id: "katya_lab__g01__02__sofa_evening__three_quarter_right__tired_honest",
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
        run_id: "katya_lab__g01__05__entryway_jacket__three_quarter_left__skeptical_pause",
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
    ],
  });
  ok(plan.planned_runs.some((run) => run.scene_id === "sofa_evening" || run.scene_id === "entryway_jacket"), "generation 2 keeps some winning scenes");
  ok(plan.planned_runs.some((run) => run.camera_angle_id === "three_quarter_right" || run.camera_angle_id === "three_quarter_left"), "generation 2 keeps some winning angles");
  ok(plan.planned_runs.some((run) => run.motion_preset === "tired_honest" || run.motion_preset === "skeptical_pause"), "generation 2 keeps some winning motion presets");
}

{
  const route = readFileSync("app/api/factory/blogger-learning-loop/route.ts", "utf8");
  ok(/Dry-run only/.test(route), "route declares dry-run behavior");
  ok(!/heygenCreateVideo/.test(route), "learning loop route does not render paid video");
  ok(!/confirmPaid/.test(route), "learning loop route cannot bypass paid guard");
}

{
  const runner = readFileSync("lib/factory/bloggerLearningLoopRunner.mjs", "utf8");
  ok(/--confirm-paid true/.test(runner), "runner has an explicit paid render gate");
  ok(/HEYGEN_API_KEY/.test(runner), "runner requires HeyGen key from env");
  ok(/--generation-size/.test(runner) && /, 5, 4, 20/.test(runner), "runner defaults to five-run generations");
  ok(runner.includes("Different room/angle/pose require separate Katya source looks"), "runner documents fixed-look limitation");
  ok(/--auto-select/.test(runner), "runner can auto-select winners for the next generation");
  ok(/auto-prior-results\.json/.test(runner), "runner persists auto-selection memory");
}

{
  const autopilot = readFileSync("lib/factory/bloggerLearningLoopAutopilot.mjs", "utf8");
  ok(/--start-generation/.test(autopilot), "autopilot accepts start generation");
  ok(/--count/.test(autopilot), "autopilot can run multiple generations");
  ok(/repo_prior_dir|repo-prior-dir/.test(autopilot), "autopilot can persist next prior files");
  ok(/auto-prior-results\.json/.test(autopilot), "autopilot writes auto selection artifacts");
}

{
  const source = readFileSync("lib/factory/bloggerLearningLoop.ts", "utf8");
  ok(/target_runs/.test(source), "loop exposes target run count");
  ok(/generation_size/.test(source), "loop exposes generation size");
  ok(/no product, no b-roll/.test(source), "loop explicitly excludes product and b-roll");
}

{
  const plan = buildKatyaLearningLoop({
    target_runs: 5,
    generation_size: 5,
    start_generation: 4,
    prior_results: [
      {
        run_id: "katya_lab__g03__03__entryway_jacket__three_quarter_left__skeptical_pause",
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
        run_id: "katya_lab__g03__04__mirror_selfie__three_quarter_left__friend_advice",
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
    ],
  });
  const generationRuns = plan.planned_runs.filter((run) => run.generation === 4);
  const auto = autoSelectKatyaGeneration({
    plan,
    generation: 4,
    top_k: 2,
    results: generationRuns.map((run) => ({
      ok: true,
      run_id: run.run_id,
      generation: run.generation,
      sequence: run.sequence,
      scene_id: run.scene_id,
      camera_angle_id: run.camera_angle_id,
      pose_id: run.pose_id,
      expression_id: run.expression_id,
      motion_preset: run.motion_preset,
      expressiveness: run.expressiveness,
    })),
  });
  equal(auto.ok, true, "auto selector returns a result");
  equal(auto.winners.length, 2, "auto selector chooses top k winners");
  ok(auto.winners.includes("katya_lab__g04__01__entryway_jacket__three_quarter_left__skeptical_pause"), "auto selector keeps the strongest skeptical variant");
  ok(auto.winners.includes("katya_lab__g04__04__mirror_selfie__three_quarter_left__friend_advice"), "auto selector keeps the strongest friend-advice variant");
  ok(auto.prior_results.length >= 5, "auto selector produces next-generation memory payload");
}

{
  const plan = buildKatyaLearningLoop({
    target_runs: 5,
    generation_size: 5,
    start_generation: 7,
    prior_results: [
      {
        run_id: "katya_lab__g06__04__mirror_selfie__three_quarter_left__friend_advice",
        scores: {
          face_realism: 8,
          motion_realism: 9,
          lip_sync: 7,
          voice_naturalness: 7,
          room_authenticity: 8,
          anti_ai_first_2s: 9,
          repeatability_penalty: 2,
        },
      },
      {
        run_id: "katya_lab__g06__01__mirror_selfie__three_quarter_left__friend_advice",
        scores: {
          face_realism: 8,
          motion_realism: 9,
          lip_sync: 7,
          voice_naturalness: 7,
          room_authenticity: 8,
          anti_ai_first_2s: 9,
          repeatability_penalty: 2,
        },
      },
    ],
  });
  const generationRuns = plan.planned_runs.filter((run) => run.generation === 7);
  const auto = autoSelectKatyaGeneration({
    plan,
    generation: 7,
    top_k: 2,
    results: generationRuns.map((run) => ({
      ok: true,
      run_id: run.run_id,
      generation: run.generation,
      sequence: run.sequence,
      scene_id: run.scene_id,
      camera_angle_id: run.camera_angle_id,
      pose_id: run.pose_id,
      expression_id: run.expression_id,
      motion_preset: run.motion_preset,
      expressiveness: run.expressiveness,
    })),
  });
  ok(auto.winners.includes("katya_lab__g07__04__mirror_selfie__three_quarter_left__friend_advice"), "auto selector keeps the best main winner");
  ok(auto.winners.includes("katya_lab__g07__05__mirror_selfie__three_quarter_left__skeptical_pause"), "auto selector preserves a near-best diverse family");
}

console.log("bloggerLearningLoopContract: passed");
