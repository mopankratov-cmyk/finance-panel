import { evaluateBloggerSample, type BloggerEvaluationInput, type BloggerEvaluationResult } from "@/lib/factory/bloggerEvaluation";
import type { KatyaLearningLoopPlan, KatyaLearningPriorResult, KatyaLearningRun } from "@/lib/factory/bloggerLearningLoop";

export interface BloggerLearningRenderResult {
  ok: boolean;
  run_id: string;
  generation?: number;
  sequence?: number;
  scene_id?: string;
  camera_angle_id?: string;
  pose_id?: string;
  expression_id?: string;
  motion_preset?: string;
  expressiveness?: "low" | "medium" | "high" | string;
  error?: string;
}

export interface BloggerLearningAutoSelection {
  ok: boolean;
  generation: number;
  top_k: number;
  confidence: "high" | "medium" | "low";
  winners: string[];
  needs_human_review: boolean;
  prior_results: KatyaLearningPriorResult[];
  ranked: Array<{
    run_id: string;
    rank: number;
    weighted_score_100: number;
    anti_ai_score_100: number;
    summary_label: BloggerEvaluationResult["summary_label"];
    notes: string;
  }>;
}

function clean(value: unknown, max = 160): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: number, min = 0, max = 10): number {
  return Math.max(min, Math.min(max, value));
}

function runScore(evaluation: BloggerEvaluationResult): number {
  return evaluation.weighted_score_100 * 0.65 + evaluation.anti_ai_score_100 * 0.35;
}

function countBy<T>(items: readonly T[], keyFn: (item: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    out.set(key, (out.get(key) || 0) + 1);
  }
  return out;
}

function scoreRun(run: KatyaLearningRun, familySize: number): BloggerEvaluationInput["scores"] {
  let face = 7.1;
  let motion = 7.1;
  let lip = 7.0;
  let voice = 6.9;
  let room = 7.0;
  let antiAi = 7.0;
  let repeat = 3.0;

  if (run.scene_id === "mirror_selfie") {
    face += 0.3;
    room += 1.0;
    antiAi += 1.0;
  }
  if (run.scene_id === "entryway_jacket") {
    room += 0.8;
    antiAi += 0.9;
  }
  if (run.scene_id === "sofa_evening") {
    antiAi -= 0.6;
    repeat += 0.7;
  }

  if (run.camera_angle_id === "three_quarter_left" || run.camera_angle_id === "three_quarter_right") {
    face += 0.3;
    antiAi += 0.4;
  }
  if (run.camera_angle_id === "upper_body" || run.camera_angle_id === "slightly_below") {
    face -= 0.4;
  }

  if (run.pose_id === "phone_in_hand") {
    motion += 0.9;
    antiAi += 0.7;
    repeat -= 0.5;
  }
  if (run.pose_id === "leaning_on_table") {
    motion += 0.7;
    antiAi += 0.6;
  }
  if (run.pose_id === "standing_relaxed") {
    motion -= 0.2;
  }

  if (run.expression_id === "thinking") {
    antiAi += 0.8;
    motion += 0.3;
  }
  if (run.expression_id === "friend_warning") {
    antiAi += 0.8;
    motion += 0.6;
  }
  if (run.expression_id === "neutral_curious") {
    antiAi += 0.2;
  }
  if (run.expression_id === "tired_honest") {
    antiAi -= 0.5;
  }

  if (run.motion_preset === "skeptical_pause") {
    motion += 0.7;
    antiAi += 0.9;
  }
  if (run.motion_preset === "friend_advice") {
    motion += 0.8;
    antiAi += 0.8;
  }
  if (run.motion_preset === "tired_honest" || run.motion_preset === "calm_direct") {
    antiAi -= 0.7;
    repeat += 0.7;
  }
  if (run.motion_preset === "half_smile") {
    antiAi -= 1.0;
    motion -= 0.3;
    repeat += 1.0;
  }

  if (run.expressiveness === "low") {
    antiAi += 0.7;
    repeat -= 0.4;
  }
  if (run.expressiveness === "medium") {
    antiAi += 0.1;
  }
  if (run.expressiveness === "high") {
    antiAi -= 1.2;
    motion -= 0.5;
    repeat += 1.4;
  }

  if (familySize >= 2) repeat += 1.2;
  if (familySize >= 3) repeat += 0.8;

  return {
    face_realism: clamp(face),
    motion_realism: clamp(motion),
    lip_sync: clamp(lip),
    voice_naturalness: clamp(voice),
    room_authenticity: clamp(room),
    anti_ai_first_2s: clamp(antiAi),
    repeatability_penalty: clamp(repeat),
  };
}

function selectionConfidence(ranked: BloggerEvaluationResult[], topK: number): BloggerLearningAutoSelection["confidence"] {
  const kth = ranked[topK - 1];
  const next = ranked[topK];
  if (!kth) return "low";
  const kthScore = runScore(kth);
  const nextScore = next ? runScore(next) : 0;
  const delta = kthScore - nextScore;
  if (kth.summary_label === "promote" && delta >= 5) return "high";
  if (delta >= 2) return "medium";
  return "low";
}

function familyKeyForRun(run: KatyaLearningRun): string {
  return `${run.scene_id}__${run.motion_preset}`;
}

function enforceWinnerDiversity(input: {
  ranked: BloggerEvaluationResult[];
  runById: Map<string, KatyaLearningRun>;
  topK: number;
}): string[] {
  const initial = input.ranked
    .slice(0, input.topK)
    .map((item) => String(item.run_id || ""))
    .filter(Boolean);
  if (initial.length < 2) return initial;

  const firstRun = input.runById.get(initial[0]);
  const secondRun = input.runById.get(initial[1]);
  if (!firstRun || !secondRun) return initial;
  if (familyKeyForRun(firstRun) !== familyKeyForRun(secondRun)) return initial;

  const firstScore = runScore(input.ranked[0]);
  const replacement = input.ranked.slice(input.topK).find((candidate) => {
    const run = input.runById.get(String(candidate.run_id || ""));
    if (!run) return false;
    const delta = firstScore - runScore(candidate);
    return familyKeyForRun(run) !== familyKeyForRun(firstRun) && delta <= 3;
  });

  if (!replacement?.run_id) return initial;
  return [initial[0], String(replacement.run_id)];
}

export function autoSelectKatyaGeneration(input: {
  plan: KatyaLearningLoopPlan;
  results: BloggerLearningRenderResult[];
  generation: number;
  top_k?: number;
}): BloggerLearningAutoSelection {
  const topK = Math.max(1, Math.min(5, Math.floor(input.top_k || 2)));
  const generation = input.generation;
  const runs = input.plan.planned_runs.filter((run) => run.generation === generation);
  const runById = new Map(runs.map((run) => [run.run_id, run]));
  const okResults = input.results.filter((result) => result.ok);
  const familyCounts = countBy(runs, (run) => `${run.scene_id}__${run.camera_angle_id}__${run.motion_preset}`);

  const rankedEvaluations = runs
    .filter((run) => okResults.some((result) => clean(result.run_id, 180) === run.run_id))
    .map((run) => {
      const familyKey = `${run.scene_id}__${run.camera_angle_id}__${run.motion_preset}`;
      const scores = scoreRun(run, familyCounts.get(familyKey) || 1);
      return evaluateBloggerSample({
        blogger_id: run.blogger_id,
        variant_id: run.variant_id,
        run_id: run.run_id,
        scores,
        evaluator: "auto_learning_loop",
        notes: `auto-selected from ${run.scene_id}/${run.motion_preset}/${run.pose_id}/${run.expressiveness}`,
        fail_reasons: [],
        hook_type: "blogger_actor_lab",
        frame_type: run.camera_angle_id,
        motion_preset: run.motion_preset,
        delivery_type: run.expression_id,
        face_duration_sec: 4,
      });
    })
    .sort((a, b) => runScore(b) - runScore(a));

  const winners = enforceWinnerDiversity({
    ranked: rankedEvaluations,
    runById,
    topK,
  });
  const confidence = selectionConfidence(rankedEvaluations, topK);
  const prior_results = rankedEvaluations.map((evaluation, index) => {
    const scores = Object.fromEntries(
      evaluation.axis_scores.map((axis) => [axis.axis, axis.value]),
    ) as KatyaLearningPriorResult["scores"];
    const isWinner = winners.includes(String(evaluation.run_id || ""));
    return {
      run_id: String(evaluation.run_id || ""),
      scores,
      notes: isWinner
        ? `auto-winner rank ${index + 1}: ${evaluation.notes}`
        : `auto-reviewed rank ${index + 1}: ${evaluation.notes}`,
      fail_reasons: isWinner ? [] : evaluation.summary_label === "rework" ? ["auto-demoted by heuristic scorer"] : [],
    };
  });

  return {
    ok: true,
    generation,
    top_k: topK,
    confidence,
    winners,
    needs_human_review: confidence === "low",
    prior_results,
    ranked: rankedEvaluations.map((evaluation, index) => ({
      run_id: String(evaluation.run_id || ""),
      rank: index + 1,
      weighted_score_100: evaluation.weighted_score_100,
      anti_ai_score_100: evaluation.anti_ai_score_100,
      summary_label: evaluation.summary_label,
      notes: evaluation.notes,
    })),
  };
}
