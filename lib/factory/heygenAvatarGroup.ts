import type { FacePersonaId } from "@/lib/factory/faceFoundry";

export type AvatarGroupStage = "upload" | "group" | "train" | "looks";

export interface AcceptedAngle {
  spec_id: string;
  local_path: string;
}

export interface AvatarGroupLookSpec {
  look_id: string;
  sequence: number;
  scene_id: string;
  framing: LookFraming;
  prompt: string;
}

export interface AvatarGroupStep {
  id: string;
  label: string;
  endpoint: string;
  method: "POST" | "GET";
  paid: boolean;
}

export interface AvatarGroupPlan {
  ok: boolean;
  mode: "heygen-avatar-group";
  persona_id: FacePersonaId;
  group_name: string;
  angles: AcceptedAngle[];
  steps: AvatarGroupStep[];
  looks: AvatarGroupLookSpec[];
  warnings: string[];
}

const IDENTITY_GUARD =
  "same woman, preserve exact face identity, facial proportions, skin tone, hairstyle and hair color";

const REALISM_GUARD =
  "candid unposed moment caught between movements, natural asymmetric posture, relaxed uneven shoulders, authentic amateur snapshot energy, natural skin texture with small imperfections, natural light, phone-shot realism, no glossy ad styling, no beauty-shoot feel, no stiff catalog pose, no product, no b-roll, no broken or malformed props, home looks well-kept and modern, not poor or run-down";

export type LookFraming = "close_up" | "half_body" | "full_body";

type WardrobeKey = "home_casual" | "hoodie" | "cardigan" | "out_jacket" | "nice_outfit" | "cozy_tee";

const PERSONA_WARDROBE: Record<FacePersonaId, Record<WardrobeKey, string>> = {
  manya: {
    home_casual: "simple stylish home top, casual-chic and effortless",
    hoodie: "oversized pastel hoodie, comfortable and current",
    cardigan: "soft knit cardigan over a plain top",
    out_jacket: "trench or light jacket with a shoulder bag, dressed to go out",
    nice_outfit: "nice everyday outfit: jeans and a fitted top, put-together but not dressy",
    cozy_tee: "oversized tee, cozy morning look",
  },
  vika: {
    home_casual: "trendy casual top, young and current",
    hoodie: "cropped or oversized hoodie, streetwear vibe",
    cardigan: "light knit cardigan over a tee",
    out_jacket: "denim or bomber jacket with a small bag, dressed to go out",
    nice_outfit: "fashionable outfit: straight jeans and a stylish top, try-on haul energy",
    cozy_tee: "oversized band tee, relaxed home look",
  },
  olya: {
    home_casual: "neat comfortable home top, practical and pleasant",
    hoodie: "soft casual hoodie, weekend-mom comfort",
    cardigan: "warm quality cardigan over a plain top",
    out_jacket: "smart casual coat with a tote bag, school-run ready",
    nice_outfit: "well-fitted everyday outfit: dark jeans and a nice blouse",
    cozy_tee: "soft loose tee, calm morning at home",
  },
};

const LOOK_ROWS: readonly { scene_id: string; framing: LookFraming; wardrobe: WardrobeKey; scene: string; action: string }[] = [
  { scene_id: "kitchen_counter", framing: "half_body", wardrobe: "home_casual", scene: "bright modern kitchen with light cabinets and stone countertop, tidy and well-kept", action: "leaning on the counter with one hand wrapped around a warm mug, weight shifted to one hip" },
  { scene_id: "kitchen_close", framing: "close_up", wardrobe: "cozy_tee", scene: "close phone-selfie framing in a bright modern kitchen, morning light", action: "mid-sip of coffee, eyes smiling over the cup rim" },
  { scene_id: "sofa_evening", framing: "half_body", wardrobe: "hoodie", scene: "comfortable modern sofa in warm evening lamp light, cozy well-furnished living room", action: "curled up with legs tucked under, tucking a loose strand of hair behind her ear" },
  { scene_id: "mirror_full", framing: "full_body", wardrobe: "nice_outfit", scene: "full-length mirror selfie in a stylish bedroom with a large clean mirror, full body visible head to toe", action: "phone in one hand, other hand adjusting the hem of her top, hip cocked, checking the outfit" },
  { scene_id: "mirror_close", framing: "close_up", wardrobe: "home_casual", scene: "close phone selfie near a large clean bedroom mirror, imperfect crop", action: "phone in hand, head tilted, mid-smile as if reacting to something funny" },
  { scene_id: "hallway_full", framing: "full_body", wardrobe: "out_jacket", scene: "entryway of a nice modern flat, designer coat rack behind, full body visible", action: "caught mid-motion pulling on the second sleeve of her jacket, bag hanging off the elbow" },
  { scene_id: "soft_window", framing: "half_body", wardrobe: "cardigan", scene: "spacious room near a large window, light walls, tasteful minimal decor, soft natural daylight", action: "arms loosely crossed, mid-laugh with eyes squeezed, glancing slightly off-camera" },
  { scene_id: "desk_half", framing: "half_body", wardrobe: "home_casual", scene: "tidy home-office desk with a laptop and a plant, bright modern work-from-home corner", action: "one elbow on the desk, chin on hand, pen twirling in the other hand, mid-thought" },
  { scene_id: "balcony_half", framing: "half_body", wardrobe: "cozy_tee", scene: "glazed modern balcony with city view behind, bright natural daylight", action: "hands wrapped around a mug, hair slightly moved by a breeze, relaxed morning face" },
  { scene_id: "car_close", framing: "close_up", wardrobe: "out_jacket", scene: "passenger seat of a clean modern car, daylight through the window, casual phone selfie angle", action: "seatbelt on, mid-talk expressive face as if telling a story to the camera" },
  { scene_id: "street_entrance", framing: "half_body", wardrobe: "out_jacket", scene: "outside near the entrance of a modern residential building, daylight, pleasant urban courtyard behind", action: "walking toward the camera mid-step, one hand holding phone, coat moving with the step" },
  { scene_id: "bed_morning", framing: "close_up", wardrobe: "cozy_tee", scene: "neatly made bed in a bright bedroom, soft morning light", action: "sitting cross-legged, stretching one arm up mid-yawn with a sleepy smile" },
  { scene_id: "park_walk", framing: "half_body", wardrobe: "nice_outfit", scene: "green city park, natural daylight, trees softly blurred behind", action: "mid-stride, looking back over her shoulder at the camera, hair in motion" },
  { scene_id: "plain_wall", framing: "half_body", wardrobe: "home_casual", scene: "clean light wall of a freshly renovated apartment, simple flattering daylight", action: "gesturing with both hands mid-explanation, animated storytelling face" },
];

export const HEYGEN_ENDPOINTS = {
  uploadAsset: "https://upload.heygen.com/v1/asset",
  groupCreate: "/v2/photo_avatar/avatar_group/create",
  groupAdd: "/v2/photo_avatar/avatar_group/add",
  train: "/v2/photo_avatar/train",
  trainStatus: (groupId: string) => `/v2/photo_avatar/train/status/${encodeURIComponent(groupId)}`,
  lookGenerate: "/v2/photo_avatar/look/generate",
  generationStatus: (generationId: string) => `/v2/photo_avatar/generation/${encodeURIComponent(generationId)}`,
} as const;

function lookPrompt(personaId: FacePersonaId, scene: string, wardrobe: WardrobeKey, action: string): string {
  return [IDENTITY_GUARD, scene, action, PERSONA_WARDROBE[personaId][wardrobe], REALISM_GUARD].join("; ");
}

function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

export function buildAvatarGroupLooks(personaId: FacePersonaId, count: number = LOOK_ROWS.length): AvatarGroupLookSpec[] {
  const take = clampCount(count, LOOK_ROWS.length);
  return LOOK_ROWS.slice(0, take).map((row, idx) => ({
    look_id: `look__${personaId}__${String(idx + 1).padStart(2, "0")}__${row.scene_id}`,
    sequence: idx + 1,
    scene_id: row.scene_id,
    framing: row.framing,
    prompt: lookPrompt(personaId, row.scene, row.wardrobe, row.action),
  }));
}

export function buildGroupCreatePayload(groupName: string, imageKey: string): Record<string, unknown> {
  return { name: groupName, image_key: imageKey };
}

export function buildGroupAddPayload(groupId: string, imageKeys: string[], name = "training_photos"): Record<string, unknown> {
  // v2 add requires a look `name` — omitting it returns 400 "name is invalid: Field required"
  return { group_id: groupId, image_keys: imageKeys, name };
}

export function buildTrainPayload(groupId: string): Record<string, unknown> {
  return { group_id: groupId };
}

export function buildLookGeneratePayload(groupId: string, look: AvatarGroupLookSpec): Record<string, unknown> {
  return {
    group_id: groupId,
    prompt: look.prompt,
    orientation: "vertical",
    pose: look.framing,
    style: "Realistic",
  };
}

export function buildAvatarGroupPlan(
  personaId: FacePersonaId,
  displayName: string,
  angles: AcceptedAngle[],
  lookCount: number = LOOK_ROWS.length,
): AvatarGroupPlan {
  const warnings: string[] = [];
  const cleanAngles = (angles || []).filter((a) => a?.spec_id && a?.local_path);
  if (cleanAngles.length < 3) {
    return {
      ok: false,
      mode: "heygen-avatar-group",
      persona_id: personaId,
      group_name: "",
      angles: cleanAngles,
      steps: [],
      looks: [],
      warnings: ["need at least 3 accepted angle photos to train a consistent avatar group (aim for 5-8)"],
    };
  }
  if (cleanAngles.length > 8) warnings.push("more than 8 angles: HeyGen groups train best on 5-8 clean photos, consider trimming");
  const group_name = `ugc_${personaId}_v1`;
  const steps: AvatarGroupStep[] = [
    { id: "upload", label: `upload ${cleanAngles.length} angle photos for ${displayName}`, endpoint: HEYGEN_ENDPOINTS.uploadAsset, method: "POST", paid: false },
    { id: "group", label: `create avatar group ${group_name} + add remaining photos`, endpoint: HEYGEN_ENDPOINTS.groupCreate, method: "POST", paid: false },
    { id: "train", label: "train group for identity consistency (poll until ready)", endpoint: HEYGEN_ENDPOINTS.train, method: "POST", paid: false },
    { id: "looks", label: `generate ${clampCount(lookCount, LOOK_ROWS.length)} home looks by prompt`, endpoint: HEYGEN_ENDPOINTS.lookGenerate, method: "POST", paid: true },
  ];
  return {
    ok: true,
    mode: "heygen-avatar-group",
    persona_id: personaId,
    group_name,
    angles: cleanAngles,
    steps,
    looks: buildAvatarGroupLooks(personaId, lookCount),
    warnings: [
      ...warnings,
      "Train must reach ready before look generation; looks burn credits — gate behind --confirm-paid.",
      "Every generated look must be eyeballed for identity drift before it enters the blogger registry.",
    ],
  };
}
