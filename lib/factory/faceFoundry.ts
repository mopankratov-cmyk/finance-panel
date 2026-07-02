export type FaceFoundryStage = "hero" | "angles";

export type FacePersonaId = "manya" | "vika" | "olya";

export interface FaceBloggerPersona {
  persona_id: FacePersonaId;
  display_name: string;
  niche: "cosmetics" | "clothing" | "toys";
  role: string;
  base_persona: string;
}

export interface FaceHeroSpec {
  spec_id: string;
  sequence: number;
  persona_id: FacePersonaId;
  vibe_id: string;
  prompt: string;
  hypothesis: string;
}

export interface FaceAngleSpec {
  spec_id: string;
  sequence: number;
  angle_id: string;
  hero_image_url: string;
  prompt: string;
  hypothesis: string;
}

export interface FaceFoundryHeroPlan {
  ok: boolean;
  mode: "face-foundry-hero";
  personas: FaceBloggerPersona[];
  planned_specs: FaceHeroSpec[];
  warnings: string[];
}

export interface FaceFoundryAnglePlan {
  ok: boolean;
  mode: "face-foundry-angles";
  hero_image_url: string;
  planned_specs: FaceAngleSpec[];
  warnings: string[];
}

const REALISM_GUARD =
  "natural skin texture with visible pores and small imperfections, no beauty retouch, no glossy ad styling, natural daylight, amateur phone-camera realism, modern well-kept interior, not poor or run-down, no text, no watermark, no logo";

const SYNTHETIC_GUARD =
  "a fully synthetic person who does not exist, not a celebrity, not a lookalike of any real or famous person, unique invented face";

const IDENTITY_GUARD =
  "same woman, preserve exact face identity, facial proportions, skin tone, hairstyle and hair color";

export const FACE_PERSONAS: FaceBloggerPersona[] = [
  {
    persona_id: "manya",
    display_name: "Маня",
    niche: "cosmetics",
    role: "подруга, которая честно рассказывает про уход — tired-honest friend advice",
    base_persona: "27 year old Russian woman with a warm believable girl-next-door face",
  },
  {
    persona_id: "vika",
    display_name: "Вика",
    niche: "clothing",
    role: "молодая, снимает примерки и «что пришло с WB» — casual try-on energy",
    base_persona: "23 year old Russian woman with a lively expressive face",
  },
  {
    persona_id: "olya",
    display_name: "Оля",
    niche: "toys",
    role: "спокойная практичная мама, обзоры игрушек без наигранности",
    base_persona: "34 year old Russian mother with a calm kind practical face",
  },
];

const PERSONA_VIBES: Record<FacePersonaId, { vibe_id: string; detail: string; hypothesis: string }[]> = {
  manya: [
    {
      vibe_id: "tired_honest",
      detail: "slightly tired eyes, minimal makeup, light brown hair loosely tied, honest ordinary face after a work day",
      hypothesis: "Matches the winning tired_honest delivery from the Katya lab.",
    },
    {
      vibe_id: "soft_daylight",
      detail: "loose light brown hair, soft rounded features, warm approachable expression",
      hypothesis: "Baseline warm-approachable candidate for friend-advice hooks.",
    },
    {
      vibe_id: "freckles_natural",
      detail: "subtle freckles, reddish-brown hair in a loose bun, believable unpolished look",
      hypothesis: "Freckles and texture may read as less AI in close phone shots.",
    },
    {
      vibe_id: "dark_hair_calm",
      detail: "dark hair tied back, calm direct gaze, slightly serious face",
      hypothesis: "Calm-serious face may suit skeptical cosmetics hooks better than smiling ones.",
    },
  ],
  vika: [
    {
      vibe_id: "dark_blonde_wavy",
      detail: "wavy dark blonde hair over shoulders, light natural makeup, relaxed everyday face",
      hypothesis: "Middle-ground look between polished and plain for try-on hooks.",
    },
    {
      vibe_id: "sharp_playful",
      detail: "sharper cheekbones, straight brown hair, playful confident half-expression",
      hypothesis: "Sharper features may hold identity better across HeyGen look restyles.",
    },
    {
      vibe_id: "round_warm",
      detail: "rounder softer face, medium brown hair, warm open expression",
      hypothesis: "Softer relatable face for «что пришло с WB» unboxing energy.",
    },
    {
      vibe_id: "everyday_neutral",
      detail: "maximally ordinary unremarkable face, brown hair in a simple ponytail, neutral expression",
      hypothesis: "Deliberately unremarkable anti-AI control candidate.",
    },
  ],
  olya: [
    {
      vibe_id: "mom_warm_bob",
      detail: "shoulder-length brown bob, gentle smile lines, warm patient expression",
      hypothesis: "Classic trustworthy mom face for toy reviews.",
    },
    {
      vibe_id: "mom_tired_kind",
      detail: "slightly tired but kind eyes, dark blonde hair clipped up, no makeup, real weekday-mom look",
      hypothesis: "Tired-kind realism may out-perform polished mom stereotypes.",
    },
    {
      vibe_id: "mom_dark_tied",
      detail: "dark hair tied back, composed practical face, minimal jewelry",
      hypothesis: "Composed practical face for problem-solution toy hooks.",
    },
    {
      vibe_id: "mom_light_soft",
      detail: "light brown loose hair, soft rounded features, calm homely presence",
      hypothesis: "Softer homely variant as contrast to the practical candidates.",
    },
  ],
};

const ANGLE_ROWS: readonly { angle_id: string; shot: string; hypothesis: string; expression?: string }[] = [
  {
    angle_id: "front_neutral",
    shot: "front-facing portrait at eye level, head and shoulders, near a window with soft daylight",
    hypothesis: "Clean frontal training photo, the anchor of the avatar group.",
  },
  {
    angle_id: "three_quarter_left",
    shot: "three-quarter view turned slightly to her left, head and shoulders, clean light wall behind",
    hypothesis: "Winning Katya lab camera family; group must hold identity here.",
  },
  {
    angle_id: "three_quarter_right",
    shot: "three-quarter view turned slightly to her right, head and shoulders, bright modern room behind",
    hypothesis: "Mirror of the winning angle for symmetric coverage.",
  },
  {
    angle_id: "slightly_above",
    shot: "phone selfie angle slightly above eye level, arm-length framing, stylish modern apartment background",
    hypothesis: "Native selfie angle for mirror_selfie style hooks.",
  },
  {
    angle_id: "slightly_below",
    shot: "camera slightly below eye level as if the phone leans on a table, upper body visible",
    hypothesis: "Table-propped framing used by real UGC creators.",
  },
  {
    angle_id: "profile_soft",
    shot: "near-profile view, face turned about sixty degrees, soft daylight from the window side",
    hypothesis: "Edge-case training photo so the group does not collapse on turns.",
  },
  {
    angle_id: "warm_lamp_evening",
    shot: "front-facing portrait in warm evening lamp light, cozy well-furnished room, slight shadows on the face",
    hypothesis: "Light variation so looks survive evening-scene restyles.",
  },
  {
    angle_id: "hallway_daylight",
    shot: "head and shoulders in a modern apartment hallway with fresh renovation, natural daylight, wardrobe blurred behind",
    hypothesis: "Background variation matching the hallway scenes from the Katya lab.",
  },
  // --- training expansion: expressions (HeyGen Personal Model wants varied expressions) ---
  {
    angle_id: "soft_smile",
    shot: "front-facing portrait at eye level, head and shoulders, bright modern room",
    expression: "soft genuine smile, relaxed eyes",
    hypothesis: "Smile variant so animated smiles do not drift identity.",
  },
  {
    angle_id: "mid_speech",
    shot: "three-quarter view at eye level, head and shoulders, light modern interior",
    expression: "mouth slightly open as if mid-sentence, natural talking expression",
    hypothesis: "Open-mouth training frame improves lip-sync fidelity.",
  },
  {
    angle_id: "listening_calm",
    shot: "front-facing portrait, head tilted a few degrees, head and shoulders, soft daylight",
    expression: "calm listening expression, attentive eyes",
    hypothesis: "Non-frontal micro-pose for natural conversational frames.",
  },
  {
    angle_id: "serious_focus",
    shot: "front-facing portrait at eye level, head and shoulders, clean light wall",
    expression: "serious focused expression, no smile",
    hypothesis: "Serious variant for skeptical hooks without identity drift.",
  },
  // --- training expansion: distances ---
  {
    angle_id: "waist_up_kitchen",
    shot: "waist-up shot standing in a bright modern kitchen, arms relaxed",
    hypothesis: "Medium-distance frame; HeyGen recommends close + wide mix.",
  },
  {
    angle_id: "full_body_window",
    shot: "full body standing near a large window in a bright modern living room, whole figure visible head to toe",
    hypothesis: "Full-body training frame for full_body looks.",
  },
  {
    angle_id: "full_body_street",
    shot: "full body standing outdoors near a modern residential building, daylight, whole figure visible",
    hypothesis: "Outdoor full-body frame; varied background fights background bleed.",
  },
  // --- training expansion: light ---
  {
    angle_id: "golden_hour",
    shot: "head and shoulders near a window at golden hour, warm low sunlight on the face",
    hypothesis: "Warm directional light variant.",
  },
  {
    angle_id: "overcast_daylight",
    shot: "head and shoulders outdoors on an overcast day, soft flat natural light",
    hypothesis: "Flat outdoor light variant.",
  },
  {
    angle_id: "evening_cozy",
    shot: "head and shoulders in warm evening lamp light in a cozy modern living room",
    hypothesis: "Low warm light variant beyond the base warm_lamp shot.",
  },
  {
    angle_id: "bathroom_mirror",
    shot: "phone selfie in a clean modern bathroom mirror, bright even vanity light",
    hypothesis: "Hard even light plus mirror context, common UGC setting.",
  },
  // --- training expansion: contexts (varied backgrounds help training) ---
  {
    angle_id: "cafe_table",
    shot: "sitting at a table in a bright modern cafe, cup nearby, head and shoulders",
    hypothesis: "Public-place context frame.",
  },
  {
    angle_id: "car_seat_day",
    shot: "sitting in the passenger seat of a clean modern car, daylight through the window",
    hypothesis: "Car context matches a core UGC look.",
  },
  {
    angle_id: "park_daylight",
    shot: "head and shoulders walking in a green city park, trees softly blurred behind",
    hypothesis: "Outdoor greenery context frame.",
  },
  {
    angle_id: "staircase_modern",
    shot: "head and shoulders in a bright modern residential staircase or lobby, clean architecture behind",
    hypothesis: "Neutral architectural context frame.",
  },
  {
    angle_id: "bedroom_soft",
    shot: "sitting on a neatly made bed in a bright bedroom, soft morning light, head and shoulders",
    hypothesis: "Soft domestic context matching bed_morning look.",
  },
];

function heroPrompt(basePersona: string, detail: string): string {
  return [
    `photorealistic vertical portrait of a ${basePersona}`,
    detail,
    "looking directly at the camera, neutral friendly expression, mouth closed",
    "simple home casual top, bright modern apartment with light renovation slightly blurred behind",
    SYNTHETIC_GUARD,
    REALISM_GUARD,
  ].join("; ");
}

function anglePrompt(shot: string, expression?: string): string {
  return [
    IDENTITY_GUARD,
    shot,
    expression || "neutral relaxed expression, mouth closed",
    "simple casual wardrobe appropriate to the scene",
    REALISM_GUARD,
  ].join("; ");
}

function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

export function listFacePersonas(): FaceBloggerPersona[] {
  return FACE_PERSONAS.map((p) => ({ ...p }));
}

export function buildFaceHeroPlan(personaId?: FacePersonaId | "all", countPerPersona = 4): FaceFoundryHeroPlan {
  const wanted = !personaId || personaId === "all" ? FACE_PERSONAS : FACE_PERSONAS.filter((p) => p.persona_id === personaId);
  if (wanted.length === 0) {
    return {
      ok: false,
      mode: "face-foundry-hero",
      personas: [],
      planned_specs: [],
      warnings: [`unknown persona "${personaId}"; known: ${FACE_PERSONAS.map((p) => p.persona_id).join(", ")}, all`],
    };
  }
  const take = clampCount(countPerPersona, 4);
  const planned_specs: FaceHeroSpec[] = [];
  for (const persona of wanted) {
    const vibes = PERSONA_VIBES[persona.persona_id].slice(0, take);
    vibes.forEach((vibe, idx) => {
      planned_specs.push({
        spec_id: `face_hero__${persona.persona_id}__${String(idx + 1).padStart(2, "0")}__${vibe.vibe_id}`,
        sequence: planned_specs.length + 1,
        persona_id: persona.persona_id,
        vibe_id: vibe.vibe_id,
        prompt: heroPrompt(persona.base_persona, vibe.detail),
        hypothesis: vibe.hypothesis,
      });
    });
  }
  return {
    ok: true,
    mode: "face-foundry-hero",
    personas: wanted.map((p) => ({ ...p })),
    planned_specs,
    warnings: [
      "Hero candidates are synthetic-only; never use a photo of a real person as reference.",
      "The winner must be picked by human eyeball from rendered images, not by prompt reading.",
      "Pick at most one hero per persona; different personas must not share a face.",
    ],
  };
}

export function buildFaceAnglePlan(heroImageUrl: string, count: number = ANGLE_ROWS.length): FaceFoundryAnglePlan {
  const hero = String(heroImageUrl || "").trim();
  if (!/^https?:\/\//.test(hero)) {
    return {
      ok: false,
      mode: "face-foundry-angles",
      hero_image_url: hero,
      planned_specs: [],
      warnings: ["hero_image_url must be a fetchable http(s) URL of the chosen hero portrait"],
    };
  }
  const take = clampCount(count, ANGLE_ROWS.length);
  const planned_specs = ANGLE_ROWS.slice(0, take).map((row, idx) => ({
    spec_id: `face_angle__${String(idx + 1).padStart(2, "0")}__${row.angle_id}`,
    sequence: idx + 1,
    angle_id: row.angle_id,
    hero_image_url: hero,
    prompt: anglePrompt(row.shot, row.expression),
    hypothesis: row.hypothesis,
  }));
  return {
    ok: true,
    mode: "face-foundry-angles",
    hero_image_url: hero,
    planned_specs,
    warnings: [
      "Every angle must be eyeballed for identity drift before upload to HeyGen; drop drifted frames instead of retouching them.",
      "Aim for 5-8 accepted angles; fewer clean photos beat more inconsistent ones for avatar group training.",
    ],
  };
}
