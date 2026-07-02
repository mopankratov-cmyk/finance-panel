import { RUSSIAN_HEYGEN_BLOGGERS, type UgcBloggerRole } from "@/lib/factory/ugcStoryboard";

export type BloggerEvaluationAxis =
  | "face_realism"
  | "motion_realism"
  | "lip_sync"
  | "voice_naturalness"
  | "room_authenticity"
  | "anti_ai_first_2s"
  | "repeatability_penalty";

export interface BloggerEvaluationRubricItem {
  axis: BloggerEvaluationAxis;
  label: string;
  weight: number;
  min: number;
  max: number;
  direction: "higher_better" | "lower_better";
  help: string;
}

export interface BloggerEvaluationInput {
  blogger_id: string;
  variant_id?: string;
  run_id?: string;
  hook_type?: string;
  frame_type?: string;
  motion_preset?: string;
  delivery_type?: string;
  face_duration_sec?: number;
  evaluator?: string;
  notes?: string;
  fail_reasons?: string[];
  scores: Partial<Record<BloggerEvaluationAxis, number>>;
}

export interface BloggerEvaluationResult {
  ok: boolean;
  scorecard_version: "living_blogger_v1";
  blogger_id: string;
  variant_id: string | null;
  run_id: string | null;
  summary_label: "promote" | "keep_testing" | "rework";
  weighted_score_100: number;
  anti_ai_score_100: number;
  axis_scores: Array<{
    axis: BloggerEvaluationAxis;
    value: number;
    normalized_100: number;
    weight: number;
    direction: "higher_better" | "lower_better";
  }>;
  notes: string;
  fail_reasons: string[];
  recommendations: string[];
  warnings: string[];
  metadata: {
    hook_type: string | null;
    frame_type: string | null;
    motion_preset: string | null;
    delivery_type: string | null;
    face_duration_sec: number | null;
    evaluator: string | null;
  };
}

function clean(value: unknown, max = 180): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export const BLOGGER_EVALUATION_RUBRIC: readonly BloggerEvaluationRubricItem[] = [
  {
    axis: "face_realism",
    label: "Face realism",
    weight: 0.2,
    min: 0,
    max: 10,
    direction: "higher_better",
    help: "Does the face still read as a believable human in motion, not just in the still frame?",
  },
  {
    axis: "motion_realism",
    label: "Motion realism",
    weight: 0.18,
    min: 0,
    max: 10,
    direction: "higher_better",
    help: "Do the head movement, nods, pauses, and mouth timing feel natural rather than templated?",
  },
  {
    axis: "lip_sync",
    label: "Lip sync",
    weight: 0.12,
    min: 0,
    max: 10,
    direction: "higher_better",
    help: "Does the lip movement stay believable for this specific voice and script?",
  },
  {
    axis: "voice_naturalness",
    label: "Voice naturalness",
    weight: 0.12,
    min: 0,
    max: 10,
    direction: "higher_better",
    help: "Does the voice sound spoken and casual instead of synthetic or announcer-like?",
  },
  {
    axis: "room_authenticity",
    label: "Room authenticity",
    weight: 0.12,
    min: 0,
    max: 10,
    direction: "higher_better",
    help: "Does the room/framing feel like a real phone-shot home environment?",
  },
  {
    axis: "anti_ai_first_2s",
    label: "Anti-AI first 2 seconds",
    weight: 0.2,
    min: 0,
    max: 10,
    direction: "higher_better",
    help: "Do the first two seconds avoid the instant 'this is AI' reaction?",
  },
  {
    axis: "repeatability_penalty",
    label: "Repeatability penalty",
    weight: 0.06,
    min: 0,
    max: 10,
    direction: "lower_better",
    help: "How obvious is it that this motion/framing repeats across many runs? Lower is better.",
  },
] as const;

const DEFAULT_SCORE = 5;

function rubricByAxis(axis: BloggerEvaluationAxis): BloggerEvaluationRubricItem {
  return BLOGGER_EVALUATION_RUBRIC.find((item) => item.axis === axis)!;
}

function normalizeAxisScore(axis: BloggerEvaluationAxis, raw: unknown): { value: number; normalized_100: number } {
  const rule = rubricByAxis(axis);
  const value = clamp(raw, rule.min, rule.max, DEFAULT_SCORE);
  const span = rule.max - rule.min || 1;
  const pct = ((value - rule.min) / span) * 100;
  const normalized = rule.direction === "higher_better" ? pct : 100 - pct;
  return { value, normalized_100: Math.round(normalized * 10) / 10 };
}

function recommendationPack(result: Record<BloggerEvaluationAxis, number>, faceDurationSec: number | null): string[] {
  const out: string[] = [];
  if (result.anti_ai_first_2s < 65) out.push("Change the opening: calmer eyes, smaller head movement, less presentational delivery in the first 2 seconds.");
  if (result.motion_realism < 65) out.push("Run a motion-only batch: same hook, same blogger, different motion preset and framing.");
  if (result.repeatability_penalty < 55) out.push("Introduce a new variant family: different room, crop, and expression profile so the batch stops repeating itself.");
  if (result.voice_naturalness < 65) out.push("Re-test the voice in face context; do not judge the mp3 alone.");
  if ((faceDurationSec || 0) > 4) out.push("Clamp talking-head to 2-4 seconds and cut to proof B-roll earlier.");
  if (!out.length) out.push("Promote this variant into the next controlled batch and compare it against one tougher motion preset.");
  return out.slice(0, 4);
}

function summaryLabel(score100: number, antiAi100: number, repeatability100: number): BloggerEvaluationResult["summary_label"] {
  if (score100 >= 78 && antiAi100 >= 75 && repeatability100 >= 60) return "promote";
  if (score100 >= 60 && antiAi100 >= 58) return "keep_testing";
  return "rework";
}

export function defaultVariantIdFor(bloggerId: string): string | null {
  const found = Object.values(RUSSIAN_HEYGEN_BLOGGERS).find((blogger) => blogger.id === bloggerId);
  return found ? `${found.id}::base` : null;
}

export function roleForBlogger(bloggerId: string): UgcBloggerRole | null {
  const found = Object.values(RUSSIAN_HEYGEN_BLOGGERS).find((blogger) => blogger.id === bloggerId);
  return found?.role || null;
}

export function evaluateBloggerSample(input: BloggerEvaluationInput): BloggerEvaluationResult {
  const warnings: string[] = [];
  const failReasons = Array.isArray(input.fail_reasons)
    ? input.fail_reasons.map((item) => clean(item, 140)).filter(Boolean).slice(0, 8)
    : [];
  const faceDurationSec = input.face_duration_sec == null ? null : clamp(input.face_duration_sec, 0, 15, 3);

  if (faceDurationSec != null && faceDurationSec > 4) {
    warnings.push("face_duration_sec is above the preferred 2-4 second window");
  }
  if (!input.blogger_id) warnings.push("blogger_id is empty");

  const axisScores = BLOGGER_EVALUATION_RUBRIC.map((item) => {
    const normalized = normalizeAxisScore(item.axis, input.scores[item.axis]);
    return {
      axis: item.axis,
      value: normalized.value,
      normalized_100: normalized.normalized_100,
      weight: item.weight,
      direction: item.direction,
    };
  });

  const byAxis = Object.fromEntries(axisScores.map((item) => [item.axis, item.normalized_100])) as Record<BloggerEvaluationAxis, number>;
  const weightedScore = axisScores.reduce((sum, item) => sum + item.normalized_100 * item.weight, 0);
  const weightedScore100 = Math.round(weightedScore * 10) / 10;
  const antiAiScore100 = Math.round(((byAxis.anti_ai_first_2s * 0.55) + (byAxis.face_realism * 0.25) + (byAxis.motion_realism * 0.2)) * 10) / 10;
  const label = summaryLabel(weightedScore100, antiAiScore100, byAxis.repeatability_penalty);

  return {
    ok: !!input.blogger_id,
    scorecard_version: "living_blogger_v1",
    blogger_id: clean(input.blogger_id, 120),
    variant_id: clean(input.variant_id, 120) || defaultVariantIdFor(input.blogger_id),
    run_id: clean(input.run_id, 160) || null,
    summary_label: label,
    weighted_score_100: weightedScore100,
    anti_ai_score_100: antiAiScore100,
    axis_scores: axisScores,
    notes: clean(input.notes, 240),
    fail_reasons: failReasons,
    recommendations: recommendationPack(byAxis, faceDurationSec),
    warnings,
    metadata: {
      hook_type: clean(input.hook_type, 80) || null,
      frame_type: clean(input.frame_type, 80) || null,
      motion_preset: clean(input.motion_preset, 80) || null,
      delivery_type: clean(input.delivery_type, 80) || null,
      face_duration_sec: faceDurationSec,
      evaluator: clean(input.evaluator, 80) || null,
    },
  };
}
