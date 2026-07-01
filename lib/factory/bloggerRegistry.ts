import { RUSSIAN_HEYGEN_BLOGGERS, type UgcBloggerRole } from "@/lib/factory/ugcStoryboard";
import { defaultVariantIdFor, type BloggerEvaluationResult } from "@/lib/factory/bloggerEvaluation";

export interface BloggerVariantRecord {
  blogger_id: string;
  variant_id: string;
  blogger_name: string;
  role: UgcBloggerRole;
  status: "active" | "experimental" | "rework";
  avatar_look_id: string;
  voice_id: string | null;
  room_type: string;
  framing_type: "close_selfie" | "medium_selfie" | "upper_body_room";
  expression_profile: string;
  motion_profile: string;
  notes: string[];
  latest_scores: {
    weighted_score_100: number | null;
    anti_ai_score_100: number | null;
    repeatability_penalty_100: number | null;
  };
  source_runs: string[];
}

function cloneNotes(list: string[]): string[] {
  return list.map((item) => String(item));
}

export const DEFAULT_BLOGGER_VARIANTS: readonly BloggerVariantRecord[] = [
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.katya.id,
    variant_id: defaultVariantIdFor(RUSSIAN_HEYGEN_BLOGGERS.katya.id) || `${RUSSIAN_HEYGEN_BLOGGERS.katya.id}::base`,
    blogger_name: RUSSIAN_HEYGEN_BLOGGERS.katya.name,
    role: RUSSIAN_HEYGEN_BLOGGERS.katya.role,
    status: "active",
    avatar_look_id: RUSSIAN_HEYGEN_BLOGGERS.katya.avatarLookId,
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.katya.voiceId || null,
    room_type: "hallway_room",
    framing_type: "upper_body_room",
    expression_profile: "skeptical_friend",
    motion_profile: "calm_direct",
    notes: cloneNotes([
      "Primary blogger for detached living-blogger tests.",
      "Works better in wider phone-selfie framing than in tight close-up.",
    ]),
    latest_scores: { weighted_score_100: null, anti_ai_score_100: null, repeatability_penalty_100: null },
    source_runs: [],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.alina.id,
    variant_id: defaultVariantIdFor(RUSSIAN_HEYGEN_BLOGGERS.alina.id) || `${RUSSIAN_HEYGEN_BLOGGERS.alina.id}::base`,
    blogger_name: RUSSIAN_HEYGEN_BLOGGERS.alina.name,
    role: RUSSIAN_HEYGEN_BLOGGERS.alina.role,
    status: "experimental",
    avatar_look_id: RUSSIAN_HEYGEN_BLOGGERS.alina.avatarLookId,
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.alina.voiceId || null,
    room_type: "kitchen_daylight",
    framing_type: "medium_selfie",
    expression_profile: "honest_mom",
    motion_profile: "soft_skeptic",
    notes: cloneNotes([
      "Secondary blogger.",
      "Needs a less smooth and less repeated expression profile before scaling.",
    ]),
    latest_scores: { weighted_score_100: null, anti_ai_score_100: null, repeatability_penalty_100: null },
    source_runs: [],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.sergey.id,
    variant_id: defaultVariantIdFor(RUSSIAN_HEYGEN_BLOGGERS.sergey.id) || `${RUSSIAN_HEYGEN_BLOGGERS.sergey.id}::base`,
    blogger_name: RUSSIAN_HEYGEN_BLOGGERS.sergey.name,
    role: RUSSIAN_HEYGEN_BLOGGERS.sergey.role,
    status: "rework",
    avatar_look_id: RUSSIAN_HEYGEN_BLOGGERS.sergey.avatarLookId,
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.sergey.voiceId || null,
    room_type: "kitchen_practical",
    framing_type: "medium_selfie",
    expression_profile: "practical_dad",
    motion_profile: "minimal_nod",
    notes: cloneNotes([
      "Hold until we have a softer and less severe male expression variant.",
    ]),
    latest_scores: { weighted_score_100: null, anti_ai_score_100: null, repeatability_penalty_100: null },
    source_runs: [],
  },
] as const;

function clean(value: unknown, max = 120): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function listBloggerVariants(): BloggerVariantRecord[] {
  return DEFAULT_BLOGGER_VARIANTS.map((item) => ({
    ...item,
    notes: cloneNotes(item.notes),
    latest_scores: { ...item.latest_scores },
    source_runs: [...item.source_runs],
  }));
}

export function applyEvaluationToRegistry(
  registry: BloggerVariantRecord[],
  evaluation: BloggerEvaluationResult,
): BloggerVariantRecord[] {
  return registry.map((variant) => {
    if (variant.variant_id !== evaluation.variant_id && variant.blogger_id !== evaluation.blogger_id) return variant;
    const repeatability = evaluation.axis_scores.find((item) => item.axis === "repeatability_penalty")?.normalized_100 ?? null;
    return {
      ...variant,
      status: evaluation.summary_label === "promote"
        ? "active"
        : evaluation.summary_label === "keep_testing"
          ? variant.status === "rework" ? "experimental" : variant.status
          : "rework",
      latest_scores: {
        weighted_score_100: evaluation.weighted_score_100,
        anti_ai_score_100: evaluation.anti_ai_score_100,
        repeatability_penalty_100: repeatability,
      },
      source_runs: evaluation.run_id ? [evaluation.run_id, ...variant.source_runs.filter((item) => item !== evaluation.run_id)].slice(0, 8) : variant.source_runs,
      notes: [
        ...variant.notes.filter(Boolean),
        ...evaluation.fail_reasons.map((reason) => `fail: ${clean(reason, 120)}`),
      ].slice(-8),
    };
  });
}

export function registrySummary(registry: BloggerVariantRecord[]) {
  const active = registry.filter((item) => item.status === "active").length;
  const experimental = registry.filter((item) => item.status === "experimental").length;
  const rework = registry.filter((item) => item.status === "rework").length;
  return { total: registry.length, active, experimental, rework };
}
