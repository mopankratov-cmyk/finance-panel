import { equal, ok } from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BLOGGER_MOTION_PRESETS,
  buildControlledBloggerBatch,
  detectBloggerRepeatability,
  scoreRepeatabilityAsEvaluation,
} from "./bloggerMotion";
import { RUSSIAN_HEYGEN_BLOGGERS } from "./ugcStoryboard";

const motionSource = readFileSync("lib/factory/bloggerMotion.ts", "utf8");
const routeSource = readFileSync("app/api/factory/blogger-motion/route.ts", "utf8");

ok(/skeptical_pause/.test(motionSource), "motion taxonomy includes skeptical pause");
ok(/repeatability_penalty_0_10/.test(motionSource), "repeatability report exposes a penalty");
ok(/buildControlledBloggerBatch/.test(routeSource), "route can build controlled batches");
ok(/detectBloggerRepeatability/.test(routeSource), "route can run repeatability detection");
ok(!/heygenCreateVideo|falVideoSubmit|confirmPaid|confirmCreate/.test(routeSource), "motion route cannot launch paid providers");

{
  equal(BLOGGER_MOTION_PRESETS.length >= 7, true, "taxonomy has at least 7 motion presets");
  ok(BLOGGER_MOTION_PRESETS.every((preset) => preset.motion_prompt && preset.expression_profile), "each preset has prompt and expression");
}

{
  const batch = buildControlledBloggerBatch({
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.katya.id,
    hooks: [
      { id: "skeptic-stop", text: "Я сначала подумала: ну нет, опять какая-то штука из рекламы.", hook_type: "skeptic-stop" },
      { id: "daily-use", text: "Вот честно, я люблю вещи, где не надо разбираться полчаса.", hook_type: "daily-use" },
    ],
    motion_preset_ids: ["calm_direct", "skeptical_pause"],
    frame_types: ["upper_body_room", "medium_selfie"],
    delivery_types: ["confessional", "friend_advice"],
    face_duration_sec: 5,
    max_runs: 16,
  });

  ok(batch.ok, "controlled batch builds");
  equal(batch.runs.length, 16, "batch creates capped cross-product runs");
  ok(batch.runs.every((run) => run.face_duration_sec <= 4), "face duration is clamped");
  ok(batch.runs.every((run) => run.evaluation_seed.blogger_id === RUSSIAN_HEYGEN_BLOGGERS.katya.id), "each run has evaluation seed");
  ok(batch.repeatability.diversity_score_100 >= 60, "controlled batch is diverse enough by default");
}

{
  const report = detectBloggerRepeatability([
    { run_id: "1", motion_preset: "calm_direct", frame_type: "upper_body_room", head_turn_signature: "same_left" },
    { run_id: "2", motion_preset: "calm_direct", frame_type: "upper_body_room", head_turn_signature: "same_left" },
    { run_id: "3", motion_preset: "calm_direct", frame_type: "upper_body_room", head_turn_signature: "same_left" },
  ]);

  ok(report.repeatability_penalty_0_10 >= 6, "repeated signatures produce a high penalty");
  ok(report.repeated_axes.some((axis) => axis.axis === "motion_preset"), "motion repetition is detected");
  ok(report.repeated_axes.some((axis) => axis.axis === "head_turn_signature"), "head turn repetition is detected");
}

{
  const evaluation = scoreRepeatabilityAsEvaluation({
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.alina.id,
    samples: [
      { run_id: "1", motion_preset: "small_nod", crop_signature: "same_crop" },
      { run_id: "2", motion_preset: "small_nod", crop_signature: "same_crop" },
      { run_id: "3", motion_preset: "small_nod", crop_signature: "same_crop" },
    ],
  });
  equal(evaluation.summary_label, "rework", "repeatability-only evaluation can demote repetitive batches");
  ok(evaluation.fail_reasons.length >= 1, "repeatability evaluation returns fail reasons");
}

console.log("bloggerMotionContract: passed");
