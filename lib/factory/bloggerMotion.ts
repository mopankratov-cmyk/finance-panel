import { evaluateBloggerSample, type BloggerEvaluationInput } from "@/lib/factory/bloggerEvaluation";
import { listBloggerVariants, type BloggerVariantRecord } from "@/lib/factory/bloggerRegistry";

export type BloggerMotionPresetId =
  | "calm_direct"
  | "skeptical_pause"
  | "small_nod"
  | "half_smile"
  | "tired_honest"
  | "friend_advice"
  | "practical_demo";

export type BloggerFrameType = BloggerVariantRecord["framing_type"];
export type BloggerDeliveryType = "confessional" | "matter_of_fact" | "friend_advice" | "practical_demo";

export interface BloggerMotionPreset {
  id: BloggerMotionPresetId;
  label: string;
  motion_prompt: string;
  expression_profile: string;
  head_motion: "minimal" | "small_nod" | "soft_tilt" | "micro_pause";
  risk_notes: string[];
}

export interface ControlledBloggerBatchInput {
  blogger_id?: string;
  variant_id?: string;
  hooks: Array<{ id: string; text: string; hook_type?: string }>;
  motion_preset_ids?: BloggerMotionPresetId[];
  frame_types?: BloggerFrameType[];
  delivery_types?: BloggerDeliveryType[];
  face_duration_sec?: number;
  max_runs?: number;
}

export interface ControlledBloggerRun {
  run_id: string;
  blogger_id: string;
  variant_id: string;
  hook_id: string;
  hook_text: string;
  hook_type: string;
  motion_preset: BloggerMotionPresetId;
  frame_type: BloggerFrameType;
  delivery_type: BloggerDeliveryType;
  face_duration_sec: number;
  heygen_motion_prompt: string;
  evaluation_seed: BloggerEvaluationInput;
}

export interface ControlledBloggerBatch {
  ok: boolean;
  mode: "detached-controlled-blogger-batch";
  runs: ControlledBloggerRun[];
  repeatability: BloggerRepeatabilityReport;
  warnings: string[];
  next_actions: string[];
}

export interface BloggerRepeatabilitySample {
  run_id?: string;
  blogger_id?: string;
  variant_id?: string;
  hook_type?: string | null;
  motion_preset?: string | null;
  frame_type?: string | null;
  delivery_type?: string | null;
  expression_profile?: string | null;
  head_turn_signature?: string | null;
  crop_signature?: string | null;
  timing_signature?: string | null;
}

export interface BloggerRepeatabilityReport {
  ok: boolean;
  sample_count: number;
  repeatability_penalty_0_10: number;
  diversity_score_100: number;
  repeated_axes: Array<{ axis: string; value: string; share: number; count: number }>;
  recommendations: string[];
}

function clean(value: unknown, max = 140): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function slug(value: string): string {
  return clean(value, 80).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "_").replace(/^_+|_+$/g, "") || "run";
}

export const BLOGGER_MOTION_PRESETS: readonly BloggerMotionPreset[] = [
  {
    id: "calm_direct",
    label: "Calm direct",
    motion_prompt: "calm direct phone-selfie delivery, relaxed eyes, almost no head movement, natural breathing",
    expression_profile: "neutral_curious",
    head_motion: "minimal",
    risk_notes: ["can feel too static if repeated"],
  },
  {
    id: "skeptical_pause",
    label: "Skeptical pause",
    motion_prompt: "small skeptical pause before the second phrase, slight eyebrow movement, tiny side glance then back to camera",
    expression_profile: "skeptical_but_warm",
    head_motion: "micro_pause",
    risk_notes: ["avoid exaggerated eyebrow acting"],
  },
  {
    id: "small_nod",
    label: "Small nod",
    motion_prompt: "one small natural nod after the first clause, relaxed mouth, no presenter smile",
    expression_profile: "thinking_out_loud",
    head_motion: "small_nod",
    risk_notes: ["repeating the nod in every run becomes obvious"],
  },
  {
    id: "half_smile",
    label: "Half smile",
    motion_prompt: "subtle half-smile only near the end, not at the opening, casual friend tone",
    expression_profile: "soft_friend",
    head_motion: "minimal",
    risk_notes: ["too much smile makes it look like an ad"],
  },
  {
    id: "tired_honest",
    label: "Tired honest",
    motion_prompt: "slightly tired honest expression, normal blink, low-energy domestic phone video",
    expression_profile: "tired_honest",
    head_motion: "soft_tilt",
    risk_notes: ["too tired can lower hook energy"],
  },
  {
    id: "friend_advice",
    label: "Friend advice",
    motion_prompt: "speaks like giving advice to a friend, tiny lean toward camera, conversational pause",
    expression_profile: "friend_advice",
    head_motion: "micro_pause",
    risk_notes: ["avoid influencer-style emphasis"],
  },
  {
    id: "practical_demo",
    label: "Practical demo",
    motion_prompt: "practical and matter-of-fact, quick glance down as if about to show the product, then cut to b-roll",
    expression_profile: "practical_demo",
    head_motion: "small_nod",
    risk_notes: ["must cut to proof b-roll quickly"],
  },
] as const;

export function getMotionPreset(id: string | undefined): BloggerMotionPreset {
  return BLOGGER_MOTION_PRESETS.find((preset) => preset.id === id) || BLOGGER_MOTION_PRESETS[0];
}

function normalizeMotionIds(ids: BloggerMotionPresetId[] | undefined): BloggerMotionPresetId[] {
  const allowed = new Set(BLOGGER_MOTION_PRESETS.map((preset) => preset.id));
  const out = (ids || ["calm_direct", "skeptical_pause", "small_nod"]).filter((id) => allowed.has(id));
  return out.length ? Array.from(new Set(out)) : ["calm_direct"];
}

function normalizeFrames(frames: BloggerFrameType[] | undefined, fallback: BloggerFrameType): BloggerFrameType[] {
  const allowed: BloggerFrameType[] = ["close_selfie", "medium_selfie", "upper_body_room"];
  const out = (frames || [fallback, fallback === "upper_body_room" ? "medium_selfie" : "upper_body_room"]).filter((frame) => allowed.includes(frame));
  return out.length ? Array.from(new Set(out)) : [fallback];
}

function normalizeDelivery(types: BloggerDeliveryType[] | undefined): BloggerDeliveryType[] {
  const allowed: BloggerDeliveryType[] = ["confessional", "matter_of_fact", "friend_advice", "practical_demo"];
  const out = (types || ["confessional", "friend_advice"]).filter((type) => allowed.includes(type));
  return out.length ? Array.from(new Set(out)) : ["confessional"];
}

function findVariant(input: ControlledBloggerBatchInput): BloggerVariantRecord {
  const registry = listBloggerVariants();
  return registry.find((variant) => input.variant_id && variant.variant_id === input.variant_id)
    || registry.find((variant) => input.blogger_id && variant.blogger_id === input.blogger_id)
    || registry[0];
}

export function detectBloggerRepeatability(samples: BloggerRepeatabilitySample[]): BloggerRepeatabilityReport {
  const rows = samples.filter(Boolean);
  const repeatedAxes: BloggerRepeatabilityReport["repeated_axes"] = [];
  const axes: Array<keyof BloggerRepeatabilitySample> = [
    "motion_preset",
    "frame_type",
    "delivery_type",
    "expression_profile",
    "head_turn_signature",
    "crop_signature",
    "timing_signature",
  ];

  for (const axis of axes) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = clean(row[axis], 90);
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    const [value, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || ["", 0];
    if (value && rows.length >= 3) {
      const share = count / rows.length;
      if (share >= 0.67) repeatedAxes.push({ axis: String(axis), value, share: Math.round(share * 100) / 100, count });
    }
  }

  const worstShare = repeatedAxes.reduce((max, item) => Math.max(max, item.share), 0);
  const penalty = rows.length < 3 ? 0 : Math.min(10, Math.round((repeatedAxes.length * 1.8 + worstShare * 5) * 10) / 10);
  const diversity = Math.max(0, Math.round((100 - penalty * 10) * 10) / 10);
  const recommendations = repeatedAxes.length
    ? [
        "Vary motion preset and frame type in the next batch before generating more hooks.",
        "Keep the same hook text for at least two runs so motion can be compared independently.",
        "Demote batches where one head/crop/timing signature dominates more than two thirds of samples.",
      ]
    : ["Diversity is acceptable; compare samples on first-2s believability and proof cut timing."];

  return {
    ok: true,
    sample_count: rows.length,
    repeatability_penalty_0_10: penalty,
    diversity_score_100: diversity,
    repeated_axes: repeatedAxes,
    recommendations,
  };
}

export function buildControlledBloggerBatch(input: ControlledBloggerBatchInput): ControlledBloggerBatch {
  const warnings: string[] = [];
  const variant = findVariant(input);
  const hooks = (input.hooks || []).slice(0, 8).map((hook, idx) => ({
    id: clean(hook.id, 80) || `hook_${idx + 1}`,
    text: clean(hook.text, 220),
    hook_type: clean(hook.hook_type, 80) || clean(hook.id, 80) || `hook_${idx + 1}`,
  })).filter((hook) => hook.text);

  if (!hooks.length) warnings.push("hooks[] is empty; batch cannot produce useful runs");

  const motionIds = normalizeMotionIds(input.motion_preset_ids);
  const frames = normalizeFrames(input.frame_types, variant.framing_type);
  const deliveries = normalizeDelivery(input.delivery_types);
  const faceDuration = clamp(input.face_duration_sec, 3, 2, 4);
  const maxRuns = Math.floor(clamp(input.max_runs, 8, 1, 30));

  const runs: ControlledBloggerRun[] = [];
  for (const hook of hooks) {
    for (const motionId of motionIds) {
      for (const frame of frames) {
        for (const delivery of deliveries) {
          if (runs.length >= maxRuns) break;
          const motion = getMotionPreset(motionId);
          const runId = [
            variant.blogger_id,
            slug(hook.id),
            motion.id,
            frame,
            delivery,
            String(runs.length + 1).padStart(2, "0"),
          ].join("__");
          runs.push({
            run_id: runId,
            blogger_id: variant.blogger_id,
            variant_id: variant.variant_id,
            hook_id: hook.id,
            hook_text: hook.text,
            hook_type: hook.hook_type,
            motion_preset: motion.id,
            frame_type: frame,
            delivery_type: delivery,
            face_duration_sec: faceDuration,
            heygen_motion_prompt: motion.motion_prompt,
            evaluation_seed: {
              blogger_id: variant.blogger_id,
              variant_id: variant.variant_id,
              run_id: runId,
              hook_type: hook.hook_type,
              frame_type: frame,
              motion_preset: motion.id,
              delivery_type: delivery,
              face_duration_sec: faceDuration,
              scores: {},
            },
          });
        }
      }
    }
  }

  if (runs.length >= maxRuns) warnings.push(`batch capped at max_runs=${maxRuns}`);

  const repeatability = detectBloggerRepeatability(runs.map((run) => ({
    run_id: run.run_id,
    blogger_id: run.blogger_id,
    variant_id: run.variant_id,
    hook_type: run.hook_type,
    motion_preset: run.motion_preset,
    frame_type: run.frame_type,
    delivery_type: run.delivery_type,
    expression_profile: getMotionPreset(run.motion_preset).expression_profile,
  })));

  return {
    ok: runs.length > 0,
    mode: "detached-controlled-blogger-batch",
    runs,
    repeatability,
    warnings,
    next_actions: [
      "Render selected runs as 2-4 second HeyGen talking-head samples.",
      "Score each sample through blogger-evaluation after manual review.",
      "Use repeatability penalty before promoting a variant.",
    ],
  };
}

export function scoreRepeatabilityAsEvaluation(input: {
  blogger_id: string;
  variant_id?: string;
  run_id?: string;
  samples: BloggerRepeatabilitySample[];
}) {
  const report = detectBloggerRepeatability(input.samples);
  return evaluateBloggerSample({
    blogger_id: input.blogger_id,
    variant_id: input.variant_id,
    run_id: input.run_id,
    scores: {
      repeatability_penalty: report.repeatability_penalty_0_10,
    },
    fail_reasons: report.repeated_axes.map((axis) => `${axis.axis} repeats as ${axis.value} in ${Math.round(axis.share * 100)}% of samples`),
    notes: "repeatability-only dry-run evaluation",
  });
}
