import { evaluateBloggerSample, type BloggerEvaluationInput, type BloggerEvaluationResult } from "@/lib/factory/bloggerEvaluation";
import { BLOGGER_MOTION_PRESETS, getMotionPreset, type BloggerMotionPresetId } from "@/lib/factory/bloggerMotion";
import { listBloggerVariants, type BloggerVariantRecord } from "@/lib/factory/bloggerRegistry";

export type KatyaSceneId =
  | "home_hallway"
  | "small_kitchen"
  | "window_room"
  | "sofa_evening"
  | "messy_desk"
  | "mirror_selfie"
  | "entryway_jacket"
  | "plain_wall";

export type KatyaCameraAngleId =
  | "front_phone_eye"
  | "slightly_above"
  | "slightly_below"
  | "three_quarter_left"
  | "three_quarter_right"
  | "closer_face"
  | "upper_body";

export type KatyaPoseId =
  | "standing_relaxed"
  | "sitting_close"
  | "leaning_on_table"
  | "one_shoulder_forward"
  | "phone_in_hand"
  | "arms_low"
  | "jacket_on_chair";

export type KatyaExpressionId =
  | "neutral_curious"
  | "skeptical_soft"
  | "thinking"
  | "half_smile_late"
  | "tired_honest"
  | "friend_warning";

export interface KatyaLearningPriorResult {
  run_id: string;
  scores: Partial<BloggerEvaluationInput["scores"]>;
  notes?: string;
  fail_reasons?: string[];
}

export interface KatyaLearningLoopInput {
  blogger_id?: string;
  variant_id?: string;
  target_runs?: number;
  generation_size?: number;
  start_generation?: number;
  prior_results?: KatyaLearningPriorResult[];
  lock_winners?: string[];
}

export interface KatyaLearningRun {
  run_id: string;
  generation: number;
  sequence: number;
  blogger_id: string;
  variant_id: string;
  avatar_look_id: string | null;
  voice_id: string | null;
  script: string;
  scene_id: KatyaSceneId;
  camera_angle_id: KatyaCameraAngleId;
  pose_id: KatyaPoseId;
  expression_id: KatyaExpressionId;
  motion_preset: BloggerMotionPresetId;
  expressiveness: "low" | "medium" | "high";
  heygen_motion_prompt: string;
  heygen_visual_prompt: string;
  evaluation_seed: BloggerEvaluationInput;
  hypothesis: string;
}

export interface KatyaLearningLoopPlan {
  ok: boolean;
  mode: "katya-blogger-learning-loop";
  target_runs: number;
  generation_size: number;
  generation_count: number;
  planned_runs: KatyaLearningRun[];
  prior_evaluations: BloggerEvaluationResult[];
  promote: string[];
  demote: string[];
  next_actions: string[];
  warnings: string[];
}

interface AxisOption<T extends string> {
  id: T;
  prompt: string;
  risk?: string;
}

const SCENES: readonly AxisOption<KatyaSceneId>[] = [
  { id: "home_hallway", prompt: "ordinary Russian apartment hallway, wardrobe behind, imperfect daylight" },
  { id: "small_kitchen", prompt: "small lived-in kitchen, neutral cabinets, soft window light, no studio look" },
  { id: "window_room", prompt: "room near a window, pale wall, casual domestic light, slight background clutter" },
  { id: "sofa_evening", prompt: "evening sofa corner, warm lamp, quiet home mood, not influencer studio" },
  { id: "messy_desk", prompt: "desk corner with everyday objects, laptop edge, realistic work-from-home mess" },
  { id: "mirror_selfie", prompt: "phone selfie near a mirror, imperfect crop, realistic apartment reflection" },
  { id: "entryway_jacket", prompt: "entryway with jacket or bag in background, casual before-going-out feeling" },
  { id: "plain_wall", prompt: "plain apartment wall, simple light, intentionally boring and believable" },
];

const ANGLES: readonly AxisOption<KatyaCameraAngleId>[] = [
  { id: "front_phone_eye", prompt: "front phone camera at eye level, relaxed crop" },
  { id: "slightly_above", prompt: "phone slightly above eye level, natural selfie distortion" },
  { id: "slightly_below", prompt: "phone slightly below eye level, subtle casual angle", risk: "can look less flattering" },
  { id: "three_quarter_left", prompt: "three-quarter left angle, eyes return to camera" },
  { id: "three_quarter_right", prompt: "three-quarter right angle, not perfectly centered" },
  { id: "closer_face", prompt: "closer face crop, forehead and shoulders still visible" },
  { id: "upper_body", prompt: "upper body crop, arms mostly low, room visible" },
];

const POSES: readonly AxisOption<KatyaPoseId>[] = [
  { id: "standing_relaxed", prompt: "standing relaxed, shoulders uneven in a natural way" },
  { id: "sitting_close", prompt: "sitting close to phone, casual posture" },
  { id: "leaning_on_table", prompt: "slight lean on table, low-energy honest delivery" },
  { id: "one_shoulder_forward", prompt: "one shoulder a little forward, asymmetric human posture" },
  { id: "phone_in_hand", prompt: "phone held by creator, tiny handheld instability" },
  { id: "arms_low", prompt: "arms low and relaxed, no presenter gesturing" },
  { id: "jacket_on_chair", prompt: "casual posture near chair with jacket, domestic realism" },
];

const EXPRESSIONS: readonly AxisOption<KatyaExpressionId>[] = [
  { id: "neutral_curious", prompt: "neutral curious face, no early smile" },
  { id: "skeptical_soft", prompt: "soft skepticism in the first second, then relax" },
  { id: "thinking", prompt: "thinking-out-loud expression, normal blink, no acting" },
  { id: "half_smile_late", prompt: "half-smile only near the final words" },
  { id: "tired_honest", prompt: "slightly tired but honest, everyday human energy" },
  { id: "friend_warning", prompt: "friend-warning face, not dramatic, a little conspiratorial" },
];

const SCRIPTS = [
  "Я сначала подумала: ну нет, опять какая-то штука из рекламы. А потом поймала себя на том, что смотрю дальше.",
  "Я бы сама пролистнула, если честно. Но тут меня зацепила одна деталь.",
  "Знаешь, что странно? Сначала выглядит вообще обычно, а потом начинаешь присматриваться.",
  "Я не люблю, когда мне что-то прям продают. Поэтому скажу просто, как есть.",
  "У меня было ощущение, что это будет очередная ерунда. Но я ошиблась.",
  "Смотри, я не буду делать вид, что это вау с первой секунды. Мне стало интересно не сразу.",
] as const;

function clean(value: unknown, max = 160): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function slug(value: string): string {
  return clean(value, 90).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "_").replace(/^_+|_+$/g, "") || "run";
}

function findKatyaVariant(input: KatyaLearningLoopInput): BloggerVariantRecord {
  const registry = listBloggerVariants();
  return registry.find((variant) => input.variant_id && variant.variant_id === input.variant_id)
    || registry.find((variant) => variant.blogger_id === (input.blogger_id || "katya_russian_creator_v3b"))
    || registry[0];
}

function runScore(evaluation: BloggerEvaluationResult): number {
  return evaluation.weighted_score_100 * 0.65 + evaluation.anti_ai_score_100 * 0.35;
}

function evaluatePrior(input: KatyaLearningLoopInput, variant: BloggerVariantRecord): BloggerEvaluationResult[] {
  return (input.prior_results || []).slice(0, 200).map((result) => evaluateBloggerSample({
    blogger_id: variant.blogger_id,
    variant_id: variant.variant_id,
    run_id: result.run_id,
    scores: result.scores || {},
    notes: result.notes,
    fail_reasons: result.fail_reasons,
    evaluator: "learning_loop_prior",
  })).sort((a, b) => runScore(b) - runScore(a));
}

function axisSeed(input: KatyaLearningLoopInput, prior: BloggerEvaluationResult[]): Set<string> {
  const seeds = new Set((input.lock_winners || []).map((id) => clean(id, 120)).filter(Boolean));
  for (const winner of prior.slice(0, 8)) {
    if (winner.summary_label === "promote" || winner.weighted_score_100 >= 72) seeds.add(String(winner.run_id || ""));
  }
  return seeds;
}

function pick<T extends string>(items: readonly AxisOption<T>[], index: number, generation: number, winnerBias: number): AxisOption<T> {
  const offset = winnerBias > 0 ? generation : generation * 2;
  return items[(index + offset) % items.length];
}

function pickMotion(index: number, generation: number, winnerBias: number): BloggerMotionPresetId {
  const base = BLOGGER_MOTION_PRESETS
    .filter((preset) => preset.id !== "practical_demo")
    .map((preset) => preset.id);
  const offset = winnerBias > 0 ? generation : generation * 3;
  return base[(index + offset) % base.length] || "skeptical_pause";
}

function expressivenessFor(motion: BloggerMotionPresetId, index: number): "low" | "medium" | "high" {
  if (motion === "half_smile" || motion === "friend_advice") return index % 5 === 0 ? "high" : "medium";
  if (motion === "calm_direct" || motion === "tired_honest") return index % 3 === 0 ? "medium" : "low";
  return "medium";
}

function visualPrompt(scene: AxisOption<KatyaSceneId>, angle: AxisOption<KatyaCameraAngleId>, pose: AxisOption<KatyaPoseId>, expression: AxisOption<KatyaExpressionId>): string {
  return [
    "same Russian UGC creator Katya, preserve face identity and hair",
    scene.prompt,
    angle.prompt,
    pose.prompt,
    expression.prompt,
    "small imperfections, ordinary skin texture, no glossy ad styling, no product, no b-roll",
  ].join("; ");
}

function motionPrompt(motionId: BloggerMotionPresetId, angle: AxisOption<KatyaCameraAngleId>, pose: AxisOption<KatyaPoseId>, expression: AxisOption<KatyaExpressionId>): string {
  const motion = getMotionPreset(motionId);
  return [
    motion.motion_prompt,
    angle.prompt,
    pose.prompt,
    expression.prompt,
    "avoid repetitive left-right head loop, avoid presenter smile, keep movement subtle and non-cyclic",
  ].join("; ");
}

export function buildKatyaLearningLoop(input: KatyaLearningLoopInput = {}): KatyaLearningLoopPlan {
  const warnings: string[] = [];
  const variant = findKatyaVariant(input);
  const targetRuns = clamp(input.target_runs, 100, 1, 160);
  const generationSize = clamp(input.generation_size, 12, 4, 20);
  const startGeneration = clamp(input.start_generation, 1, 1, 50);
  const generationCount = Math.ceil(targetRuns / generationSize);
  const priorEvaluations = evaluatePrior(input, variant);
  const winners = axisSeed(input, priorEvaluations);
  const winnerBias = winners.size;

  if (targetRuns > 40) warnings.push("large paid render target: execute in generations and stop after each review checkpoint");
  if (!priorEvaluations.length) warnings.push("no prior_results supplied; generation 1 is exploratory and should not render all 100 at once");
  if (!variant.avatar_look_id) warnings.push("selected Katya variant has no avatar look id");

  const plannedRuns: KatyaLearningRun[] = [];
  for (let i = 0; i < targetRuns; i++) {
    const generation = startGeneration + Math.floor(i / generationSize);
    const sequence = (i % generationSize) + 1;
    const scene = pick(SCENES, i, generation, winnerBias);
    const angle = pick(ANGLES, i * 2, generation, winnerBias);
    const pose = pick(POSES, i * 3, generation, winnerBias);
    const expression = pick(EXPRESSIONS, i * 5, generation, winnerBias);
    const motion = pickMotion(i, generation, winnerBias);
    const expressiveness = expressivenessFor(motion, i);
    const script = SCRIPTS[(i + generation) % SCRIPTS.length];
    const runId = [
      "katya_lab",
      `g${String(generation).padStart(2, "0")}`,
      String(sequence).padStart(2, "0"),
      slug(scene.id),
      slug(angle.id),
      slug(motion),
    ].join("__");

    plannedRuns.push({
      run_id: runId,
      generation,
      sequence,
      blogger_id: variant.blogger_id,
      variant_id: variant.variant_id,
      avatar_look_id: variant.avatar_look_id || null,
      voice_id: variant.voice_id || null,
      script,
      scene_id: scene.id,
      camera_angle_id: angle.id,
      pose_id: pose.id,
      expression_id: expression.id,
      motion_preset: motion,
      expressiveness,
      heygen_motion_prompt: motionPrompt(motion, angle, pose, expression),
      heygen_visual_prompt: visualPrompt(scene, angle, pose, expression),
      hypothesis: `Test whether ${scene.id} + ${angle.id} + ${pose.id} + ${motion} lowers the first-2s AI read without losing attention.`,
      evaluation_seed: {
        blogger_id: variant.blogger_id,
        variant_id: variant.variant_id,
        run_id: runId,
        hook_type: "blogger_actor_lab",
        frame_type: angle.id,
        motion_preset: motion,
        delivery_type: expression.id,
        face_duration_sec: 4,
        scores: {},
      },
    });
  }

  const promote = priorEvaluations
    .filter((item) => item.summary_label === "promote" || runScore(item) >= 76)
    .slice(0, 12)
    .map((item) => String(item.run_id || ""))
    .filter(Boolean);
  const demote = priorEvaluations
    .filter((item) => item.summary_label === "rework" || item.anti_ai_score_100 < 55)
    .slice(0, 12)
    .map((item) => String(item.run_id || ""))
    .filter(Boolean);

  return {
    ok: plannedRuns.length > 0,
    mode: "katya-blogger-learning-loop",
    target_runs: targetRuns,
    generation_size: generationSize,
    generation_count: generationCount,
    planned_runs: plannedRuns,
    prior_evaluations: priorEvaluations,
    promote,
    demote,
    warnings,
    next_actions: [
      "Render only the next generation, not all 100 runs at once.",
      "After each generation, score every mp4 with living_blogger_v1 and user winner labels.",
      "Promote settings that improve anti_ai_first_2s and motion_realism together.",
      "Demote high expressiveness if it creates presenter smile or repeated head loops.",
      "Keep B-roll and product disabled until Katya's actor baseline is stable.",
    ],
  };
}
