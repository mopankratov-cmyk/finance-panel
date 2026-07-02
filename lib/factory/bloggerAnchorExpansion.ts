import { listBloggerVariants } from "@/lib/factory/bloggerRegistry";

export interface KatyaExpansionRun {
  run_id: string;
  generation: number;
  sequence: number;
  blogger_id: string;
  variant_id: string;
  avatar_look_id: string;
  avatar_look_label: string;
  voice_id: string | null;
  scene_id: "mirror_selfie" | "entryway_jacket" | "small_kitchen" | "window_room" | "plain_wall" | "home_hallway";
  motion_preset: "friend_advice";
  camera_angle_id: "three_quarter_left" | "upper_body" | "slightly_below";
  pose_id: "phone_in_hand" | "leaning_on_table" | "sitting_close" | "standing_relaxed" | "arms_low";
  expression_id: "friend_warning" | "thinking" | "neutral_curious" | "skeptical_soft";
  expressiveness: "medium" | "low";
  script: string;
  heygen_motion_prompt: string;
  heygen_visual_prompt: string;
  hypothesis: string;
}

export interface KatyaExpansionPlan {
  ok: boolean;
  mode: "katya-anchor-expansion";
  anchor_run_ids: string[];
  planned_runs: KatyaExpansionRun[];
  warnings: string[];
}

const LOOKS = {
  hallway_hoodie: "f9e4ecf1b902451aaa17e8c2430a5c1b",
  kitchen_cardigan: "8dd0451ca8af4d25b5222014d3f0657f",
  soft_window_cardigan: "fa4d7d0f63874e4499cb95754b75ef94",
  skeptical_kitchen_selfie: "78503a862d8140c2b0c389e6b6cf101d",
} as const;

const SCRIPT = "Смотри, я не буду делать вид, что это вау с первой секунды. Мне стало интересно не сразу.";

function clean(value: unknown, max = 120): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function variant() {
  const found = listBloggerVariants().find((item) => item.blogger_id === "katya_russian_creator_v3b");
  if (!found) throw new Error("Katya variant not found");
  return found;
}

function visualPrompt(scenePrompt: string, wardrobePrompt: string, cameraPrompt: string, posturePrompt: string, expressionPrompt: string) {
  return [
    "same Russian UGC creator Katya, preserve face identity and hair",
    scenePrompt,
    wardrobePrompt,
    cameraPrompt,
    posturePrompt,
    expressionPrompt,
    "small imperfections, ordinary skin texture, rough everyday light, no glossy ad styling, no beauty-shoot feel, no product, no b-roll, no broken mug or malformed props",
  ].join("; ");
}

function motionPrompt(cameraPrompt: string, posturePrompt: string, expressionPrompt: string) {
  return [
    "speaks like giving advice to a friend, tiny lean toward camera, conversational pause",
    cameraPrompt,
    posturePrompt,
    expressionPrompt,
    "avoid repetitive left-right head loop, avoid presenter smile, keep movement subtle and non-cyclic, no malformed props or object glitches",
  ].join("; ");
}

export function buildKatyaAnchorExpansion(generation = 13): KatyaExpansionPlan {
  const base = variant();
  const anchorIds = [
    "katya_lab__g11__04__mirror_selfie__three_quarter_left__friend_advice",
    "katya_lab__g12__04__mirror_selfie__three_quarter_left__friend_advice",
  ];
  const rows = [
    {
      scene_id: "mirror_selfie" as const,
      avatar_look_id: LOOKS.skeptical_kitchen_selfie,
      avatar_look_label: "skeptical_kitchen_selfie",
      camera_angle_id: "three_quarter_left" as const,
      pose_id: "phone_in_hand" as const,
      expression_id: "friend_warning" as const,
      expressiveness: "medium" as const,
      scenePrompt: "phone selfie near a mirror, imperfect crop, realistic apartment reflection",
      wardrobePrompt: "same casual top and home look as the winning anchor, phone-shot realism",
      cameraPrompt: "three-quarter left angle, eyes return to camera, imperfect handheld crop",
      posturePrompt: "phone held by creator, tiny handheld instability",
      expressionPrompt: "friend-warning face, not dramatic, a little conspiratorial",
      hypothesis: "Baseline anchor preservation check before expansion.",
    },
    {
      scene_id: "home_hallway" as const,
      avatar_look_id: LOOKS.hallway_hoodie,
      avatar_look_label: "hallway_hoodie",
      camera_angle_id: "upper_body" as const,
      pose_id: "standing_relaxed" as const,
      expression_id: "skeptical_soft" as const,
      expressiveness: "low" as const,
      scenePrompt: "ordinary Russian apartment hallway, wardrobe behind, imperfect daylight",
      wardrobePrompt: "hoodie and simple home pants, before-going-out but not styled",
      cameraPrompt: "upper body crop, more torso visible, slightly imperfect phone framing",
      posturePrompt: "standing relaxed, shoulders uneven in a natural way",
      expressionPrompt: "soft skepticism in the first second, then relax",
      hypothesis: "Test a more body-visible hallway frame with rough everyday realism and less beauty feel.",
    },
    {
      scene_id: "entryway_jacket" as const,
      avatar_look_id: LOOKS.hallway_hoodie,
      avatar_look_label: "hallway_hoodie",
      camera_angle_id: "slightly_below" as const,
      pose_id: "arms_low" as const,
      expression_id: "friend_warning" as const,
      expressiveness: "low" as const,
      scenePrompt: "entryway with jacket or bag in background, casual before-going-out feeling",
      wardrobePrompt: "casual outer layer with very ordinary hallway styling, not polished",
      cameraPrompt: "phone slightly below eye level, more torso and doorway visible",
      posturePrompt: "arms low and relaxed, no presenter gesturing",
      expressionPrompt: "friend-warning face, not dramatic, a little conspiratorial",
      hypothesis: "Keep the winning delivery but make the frame more body-visible and less beauty-driven.",
    },
    {
      scene_id: "small_kitchen" as const,
      avatar_look_id: LOOKS.kitchen_cardigan,
      avatar_look_label: "kitchen_cardigan",
      camera_angle_id: "upper_body" as const,
      pose_id: "leaning_on_table" as const,
      expression_id: "thinking" as const,
      expressiveness: "low" as const,
      scenePrompt: "small lived-in kitchen, neutral cabinets, uneven domestic light, no studio look",
      wardrobePrompt: "everyday kitchen homewear, slightly messy and very ordinary",
      cameraPrompt: "upper body crop near kitchen counter, more arms and torso visible",
      posturePrompt: "slight lean on table, low-energy honest delivery",
      expressionPrompt: "thinking-out-loud expression, normal blink, no acting",
      hypothesis: "Test kitchen counter half-body realism with rougher domestic atmosphere.",
    },
    {
      scene_id: "window_room" as const,
      avatar_look_id: LOOKS.soft_window_cardigan,
      avatar_look_label: "soft_window_cardigan",
      camera_angle_id: "upper_body" as const,
      pose_id: "standing_relaxed" as const,
      expression_id: "neutral_curious" as const,
      expressiveness: "low" as const,
      scenePrompt: "room near a window, pale wall, casual domestic light, slight background clutter, not pretty",
      wardrobePrompt: "soft cardigan in window light, slightly unstyled apartment look",
      cameraPrompt: "upper body standing frame, more torso visible, phone shot feels ordinary",
      posturePrompt: "standing relaxed, shoulders uneven in a natural way",
      expressionPrompt: "neutral curious face, no early smile",
      hypothesis: "Test whether standing near a window can work without sliding into glossy lifestyle visuals.",
    },
    {
      scene_id: "plain_wall" as const,
      avatar_look_id: LOOKS.soft_window_cardigan,
      avatar_look_label: "soft_window_cardigan",
      camera_angle_id: "upper_body" as const,
      pose_id: "phone_in_hand" as const,
      expression_id: "friend_warning" as const,
      expressiveness: "low" as const,
      scenePrompt: "plain apartment wall, flat simple light, intentionally boring and believable",
      wardrobePrompt: "simple home casual top, no styling effort, believable everyday appearance",
      cameraPrompt: "upper body crop with more body visible, rough phone framing",
      posturePrompt: "phone held by creator, tiny handheld instability",
      expressionPrompt: "friend-warning face, not dramatic, a little conspiratorial",
      hypothesis: "Test upper-body plain-wall realism with zero lifestyle gloss and stronger body presence.",
    },
  ];

  const planned_runs = rows.map((row, idx) => ({
    run_id: `katya_expand__g${String(generation).padStart(2, "0")}__${String(idx + 1).padStart(2, "0")}__${row.scene_id}__friend_advice`,
    generation,
    sequence: idx + 1,
    blogger_id: base.blogger_id,
    variant_id: base.variant_id,
    avatar_look_id: row.avatar_look_id,
    avatar_look_label: row.avatar_look_label,
    voice_id: base.voice_id || null,
    scene_id: row.scene_id,
    motion_preset: "friend_advice" as const,
    camera_angle_id: row.camera_angle_id,
    pose_id: row.pose_id,
    expression_id: row.expression_id,
    expressiveness: row.expressiveness,
    script: SCRIPT,
    heygen_motion_prompt: motionPrompt(row.cameraPrompt, row.posturePrompt, row.expressionPrompt),
    heygen_visual_prompt: visualPrompt(row.scenePrompt, row.wardrobePrompt, row.cameraPrompt, row.posturePrompt, row.expressionPrompt),
    hypothesis: row.hypothesis,
  }));

  return {
    ok: true,
    mode: "katya-anchor-expansion",
    anchor_run_ids: anchorIds,
    planned_runs,
    warnings: [
      "Expansion mode preserves the winning motion-core and changes environment / wardrobe only.",
      "Any malformed mug / broken prop read should be treated as a fail-pattern and not promoted.",
    ],
  };
}
