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
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.katya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.katya.id}::mirror_core`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.katya.name} Mirror Core`,
    role: RUSSIAN_HEYGEN_BLOGGERS.katya.role,
    status: "active",
    avatar_look_id: "78503a862d8140c2b0c389e6b6cf101d",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.katya.voiceId || null,
    room_type: "mirror_selfie",
    framing_type: "medium_selfie",
    expression_profile: "friend_warning",
    motion_profile: "friend_advice",
    notes: cloneNotes([
      "Human-picked best motion-core anchor from g11-04 / g12-04.",
      "Use as control for all future Katya look expansion tests.",
    ]),
    latest_scores: { weighted_score_100: null, anti_ai_score_100: null, repeatability_penalty_100: null },
    source_runs: ["katya_lab__g11__04__mirror_selfie__three_quarter_left__friend_advice", "katya_lab__g12__04__mirror_selfie__three_quarter_left__friend_advice"],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.katya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.katya.id}::hallway_standing`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.katya.name} Hallway Standing`,
    role: RUSSIAN_HEYGEN_BLOGGERS.katya.role,
    status: "experimental",
    avatar_look_id: "f9e4ecf1b902451aaa17e8c2430a5c1b",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.katya.voiceId || null,
    room_type: "home_hallway",
    framing_type: "upper_body_room",
    expression_profile: "skeptical_soft",
    motion_profile: "friend_advice",
    notes: cloneNotes([
      "Body-visible hallway variant for ordinary apartment realism.",
      "Prioritize rough everyday light over beauty feel.",
    ]),
    latest_scores: { weighted_score_100: null, anti_ai_score_100: null, repeatability_penalty_100: null },
    source_runs: ["katya_expand__g14__02__home_hallway__friend_advice"],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.katya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.katya.id}::kitchen_counter`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.katya.name} Kitchen Counter`,
    role: RUSSIAN_HEYGEN_BLOGGERS.katya.role,
    status: "experimental",
    avatar_look_id: "8dd0451ca8af4d25b5222014d3f0657f",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.katya.voiceId || null,
    room_type: "small_kitchen",
    framing_type: "upper_body_room",
    expression_profile: "thinking",
    motion_profile: "friend_advice",
    notes: cloneNotes([
      "Kitchen counter half-body variant.",
      "Use when we need more torso and domestic counter context without gloss.",
    ]),
    latest_scores: { weighted_score_100: null, anti_ai_score_100: null, repeatability_penalty_100: null },
    source_runs: ["katya_expand__g14__04__small_kitchen__friend_advice"],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.katya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.katya.id}::window_room`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.katya.name} Window Room`,
    role: RUSSIAN_HEYGEN_BLOGGERS.katya.role,
    status: "experimental",
    avatar_look_id: "fa4d7d0f63874e4499cb95754b75ef94",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.katya.voiceId || null,
    room_type: "window_room",
    framing_type: "upper_body_room",
    expression_profile: "neutral_curious",
    motion_profile: "friend_advice",
    notes: cloneNotes([
      "Window-room look for daylight tests.",
      "Keep this variant under anti-gloss watch; it tends to over-prettify quickly.",
    ]),
    latest_scores: { weighted_score_100: null, anti_ai_score_100: null, repeatability_penalty_100: null },
    source_runs: ["katya_expand__g14__05__window_room__friend_advice"],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.katya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.katya.id}::plain_wall_utility`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.katya.name} Plain Wall Utility`,
    role: RUSSIAN_HEYGEN_BLOGGERS.katya.role,
    status: "experimental",
    avatar_look_id: "fa4d7d0f63874e4499cb95754b75ef94",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.katya.voiceId || null,
    room_type: "plain_wall",
    framing_type: "upper_body_room",
    expression_profile: "friend_warning",
    motion_profile: "friend_advice",
    notes: cloneNotes([
      "Utility anti-gloss fallback with plain wall and flatter light.",
      "Good control when richer rooms start looking too polished.",
    ]),
    latest_scores: { weighted_score_100: null, anti_ai_score_100: null, repeatability_penalty_100: null },
    source_runs: ["katya_expand__g14__06__plain_wall__friend_advice"],
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
  // --- Поколение face-foundry 2026-07-02 (Маня/Вика/Оля): собственные лица,
  // обученные HeyGen-группы, паспорта в docs/factory-blogger-passports.json.
  // Оценки — первый прогон vision-критика по кадровым полосам бейкоффа 2026-07-02.
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.manya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.manya.id}::car_voice_message`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.manya.name} Car Voice Message`,
    role: RUSSIAN_HEYGEN_BLOGGERS.manya.role,
    status: "active",
    avatar_look_id: "f3d97943d5854f28bda126ad03f02bab",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.manya.voiceId || null,
    room_type: "car_passenger_seat",
    framing_type: "close_selfie",
    expression_profile: "friend_advice",
    motion_profile: "voice_message",
    notes: cloneNotes([
      "Ремень+сумка+свет из окна прячут AI-природу; рамка «голосовое сообщение».",
      "MiniMax speech-02-hd через external audio_url живее HeyGen TTS (см. паспорта).",
    ]),
    latest_scores: { weighted_score_100: 75, anti_ai_score_100: 75, repeatability_penalty_100: null },
    source_runs: ["heygen:e52c7bd20f964ac49012791a84dd0af7", "heygen:53ae6c0989384f6791d42bbeb7e0c71f"],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.manya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.manya.id}::mirror_selfie`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.manya.name} Mirror Selfie`,
    role: RUSSIAN_HEYGEN_BLOGGERS.manya.role,
    status: "experimental",
    avatar_look_id: "f06873dbf95e462aa0d1f6c0eb0e8408",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.manya.voiceId || null,
    room_type: "bedroom_mirror",
    framing_type: "medium_selfie",
    expression_profile: "soft_friend",
    motion_profile: "calm_direct",
    notes: cloneNotes(["Low-energy селфи-рамка; вторая линия после машины."]),
    latest_scores: { weighted_score_100: 70, anti_ai_score_100: 70, repeatability_penalty_100: null },
    source_runs: ["heygen:9004a491c0dc431b9ad3a1f9703cdab2"],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.vika.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.vika.id}::car_voice_message`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.vika.name} Car Voice Message`,
    role: RUSSIAN_HEYGEN_BLOGGERS.vika.role,
    status: "active",
    avatar_look_id: "96171867fa664fb18b5f257f84c0f63a",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.vika.voiceId || null,
    room_type: "car_passenger_seat",
    framing_type: "close_selfie",
    expression_profile: "neutral_curious",
    motion_profile: "voice_message",
    notes: cloneNotes([
      "Лучший кадровый скор бейкоффа (~8/10): идентичность железная, рот живой.",
      "Следить за презентерской полуулыбкой в конце клипов.",
    ]),
    latest_scores: { weighted_score_100: 80, anti_ai_score_100: 78, repeatability_penalty_100: null },
    source_runs: ["heygen:2de3cd516bcd4c16a45e52f66cbd2087"],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.vika.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.vika.id}::mirror_selfie`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.vika.name} Mirror Selfie`,
    role: RUSSIAN_HEYGEN_BLOGGERS.vika.role,
    status: "experimental",
    avatar_look_id: "2d5d8b6f5511488d99b36fea3467d3d5",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.vika.voiceId || null,
    room_type: "bedroom_mirror",
    framing_type: "medium_selfie",
    expression_profile: "soft_friend",
    motion_profile: "calm_direct",
    notes: cloneNotes(["Селфи-рамка под примерки; для try-on лучше mirror_full (полный рост)."]),
    latest_scores: { weighted_score_100: 72, anti_ai_score_100: 72, repeatability_penalty_100: null },
    source_runs: ["heygen:70736adcdc164b989562f96e1a7be059"],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.olya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.olya.id}::mirror_selfie`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.olya.name} Mirror Selfie`,
    role: RUSSIAN_HEYGEN_BLOGGERS.olya.role,
    status: "active",
    avatar_look_id: "6359cf4afc1849d798fdfa4e0873f27a",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.olya.voiceId || null,
    room_type: "bedroom_mirror",
    framing_type: "medium_selfie",
    expression_profile: "honest_mom",
    motion_profile: "calm_direct",
    notes: cloneNotes([
      "Живая жестикуляция рукой, заколка как identity-якорь; взгляд честно на экран.",
    ]),
    latest_scores: { weighted_score_100: 75, anti_ai_score_100: 74, repeatability_penalty_100: null },
    source_runs: ["heygen:7ac38df34f004c58a8fa7826791a8240"],
  },
  {
    blogger_id: RUSSIAN_HEYGEN_BLOGGERS.olya.id,
    variant_id: `${RUSSIAN_HEYGEN_BLOGGERS.olya.id}::car_voice_message`,
    blogger_name: `${RUSSIAN_HEYGEN_BLOGGERS.olya.name} Car Voice Message`,
    role: RUSSIAN_HEYGEN_BLOGGERS.olya.role,
    status: "experimental",
    avatar_look_id: "87e6ae6ac6654d4b919fbb3a8a5fe6f6",
    voice_id: RUSSIAN_HEYGEN_BLOGGERS.olya.voiceId || null,
    room_type: "car_passenger_seat",
    framing_type: "close_selfie",
    expression_profile: "honest_mom",
    motion_profile: "voice_message",
    notes: cloneNotes(["Мама-в-машине после школьного маршрута; вторая линия."]),
    latest_scores: { weighted_score_100: 72, anti_ai_score_100: 72, repeatability_penalty_100: null },
    source_runs: ["heygen:8f0ef01f73be42afbbfa2ca612c5a737"],
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
