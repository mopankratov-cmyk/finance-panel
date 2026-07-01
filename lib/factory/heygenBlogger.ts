// HeyGen UGC-блогер — Metric Registry (ЕДИНЫЙ источник правды «по всем метрикам»).
// Из этого файла растут И ручная панель (app/inferno/heygen-blogger), И agent-tool (heygenAgentTool.ts).
// ПРАВИЛО: список метрик и их значения не хардкодятся нигде, кроме METRIC_REGISTRY.
// Чистый модуль без зависимостей и без сети (инертен). Спека: docs/factory-ugc-heygen-integration-spec.md

// ── Enum-значения (единственное место определения) ──
export const IDENTITY_SOURCE = ["existing_look", "upload_own_face", "prompt_design_ai", "mixed"] as const;
export const AGE = ["Young Adult", "Early Middle Age", "Late Middle Age", "Senior", "Unspecified"] as const;
export const GENDER = ["Woman", "Man", "Unspecified"] as const;
export const ETHNICITY = ["White", "Black", "Asian American", "East Asian", "South East Asian", "South Asian", "Middle Eastern", "Pacific", "Hispanic", "Unspecified"] as const;
export const ORIENTATION = ["vertical", "horizontal", "square"] as const; // API; UI: Portrait/Landscape/Square
export const POSE = ["full_body", "half_body", "close_up"] as const; // UI: Full Body / Upper Body / Face
export const AVATAR_STYLE = ["Realistic", "Pixar", "Cinematic", "Vintage", "Noir", "Cyberpunk"] as const;
export const ASPECT_RATIO = ["9:16", "16:9", "4:5", "1:1", "auto"] as const;
export const RESOLUTION = ["720p", "1080p", "4k"] as const;
export const VIDEO_ENGINE = ["avatar_iv", "presenter_v", "cinematic_seedance"] as const;
export const VOICE_MODE = ["visual_only", "heygen_tts", "external_audio"] as const;
export const VOICE_EMOTION = ["Excited", "Friendly", "Serious", "Soothing", "Broadcaster", "Default"] as const;
export const BACKGROUND_TYPE = ["transparent", "color", "image", "video"] as const;
export const DURATION_MODE = ["auto", "custom"] as const;
export const OUTPUT_FORMAT = ["mp4", "webm"] as const;

export type IdentitySource = typeof IDENTITY_SOURCE[number];
export type Age = typeof AGE[number];
export type Gender = typeof GENDER[number];
export type Ethnicity = typeof ETHNICITY[number];
export type Orientation = typeof ORIENTATION[number];
export type Pose = typeof POSE[number];
export type AvatarStyle = typeof AVATAR_STYLE[number];
export type AspectRatio = typeof ASPECT_RATIO[number];
export type Resolution = typeof RESOLUTION[number];
export type VideoEngine = typeof VIDEO_ENGINE[number];
export type VoiceMode = typeof VOICE_MODE[number];
export type VoiceEmotion = typeof VOICE_EMOTION[number];
export type BackgroundType = typeof BACKGROUND_TYPE[number];
export type DurationMode = typeof DURATION_MODE[number];
export type OutputFormat = typeof OUTPUT_FORMAT[number];

// ── Тип метрики в реестре ──
export type MetricGroup = "identity" | "voice" | "render" | "motion" | "broll" | "budget";
export type MetricType = "enum" | "number" | "boolean" | "text" | "image_keys";
export type MetricStage = "S1" | "S3" | "config";

export interface MetricDef {
  id: string;                    // dot-path в BloggerConfig, напр. "identity.age", "render.aspectRatio"
  group: MetricGroup;
  label: string;
  type: MetricType;
  options?: readonly string[];   // для enum
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  stage: MetricStage;
  api: boolean;                  // true = автоматизируется через API; false = ручной UI-шаг (Cinematic)
  credits?: string;              // заметка про списание
  help?: string;
}

// Персона-промпт по умолчанию (см. §7 research)
export const DEFAULT_APPEARANCE =
  "Ordinary young woman 25–34, minimal makeup, casual clothes (hoodie / cardigan / plain tee), " +
  "friendly but slightly skeptical expression. Amateur selfie vibe, phone front camera, soft natural daylight. " +
  "Not a model, not a studio presenter.";

// ── РЕЕСТР МЕТРИК (единственный источник) ──
export const METRIC_REGISTRY: readonly MetricDef[] = [
  // identity (S1)
  { id: "identity.name", group: "identity", label: "Имя блогера", type: "text", default: "Yoyo", stage: "S1", api: true },
  { id: "identity.source", group: "identity", label: "Источник лица", type: "enum", options: IDENTITY_SOURCE, default: "existing_look", stage: "S1", api: true, help: "готовый look / залить своё лицо / промпт / микс" },
  { id: "identity.avatarGroupId", group: "identity", label: "Avatar group ID", type: "text", default: "", stage: "S1", api: true, help: "из GET /v3/avatars; не используется как avatar_id для видео" },
  { id: "identity.avatarLookId", group: "identity", label: "Avatar look ID", type: "text", default: "", stage: "S1", api: true, help: "из GET /v3/avatars/looks; именно look id идёт в video.avatar_id" },
  { id: "identity.age", group: "identity", label: "Возраст", type: "enum", options: AGE, default: "Young Adult", stage: "S1", api: true },
  { id: "identity.gender", group: "identity", label: "Пол", type: "enum", options: GENDER, default: "Woman", stage: "S1", api: true },
  { id: "identity.ethnicity", group: "identity", label: "Этнос", type: "enum", options: ETHNICITY, default: "Unspecified", stage: "S1", api: true, help: "решение владельца" },
  { id: "identity.style", group: "identity", label: "Стиль", type: "enum", options: AVATAR_STYLE, default: "Realistic", stage: "S1", api: true },
  { id: "identity.orientation", group: "identity", label: "Ориентация", type: "enum", options: ORIENTATION, default: "vertical", stage: "S1", api: true },
  { id: "identity.pose", group: "identity", label: "Поза", type: "enum", options: POSE, default: "half_body", stage: "S1", api: true },
  { id: "identity.appearance", group: "identity", label: "Описание внешности", type: "text", default: DEFAULT_APPEARANCE, stage: "S1", api: true },
  { id: "identity.train", group: "identity", label: "Тренировать группу", type: "boolean", default: true, stage: "S1", api: true, help: "консистентность лица между looks/видео" },
  { id: "identity.consentConfirmed", group: "identity", label: "Права на лицо подтверждены", type: "boolean", default: false, stage: "S1", api: true, help: "обязательно при заливке лица" },
  { id: "identity.faceImageKeys", group: "identity", label: "Фото лица (image_keys)", type: "image_keys", default: [], stage: "S1", api: true, help: "5–8 ракурсов при source=upload/mixed" },

  // voice (S3)
  { id: "voice.mode", group: "voice", label: "Режим звука", type: "enum", options: VOICE_MODE, default: "visual_only", stage: "S3", api: true, help: "visual_only = добиваем лицо/жесты без голоса; heygen_tts = временный синтез; external_audio = позже липсинк по mp3" },
  { id: "voice.voiceId", group: "voice", label: "Voice ID", type: "text", default: "", stage: "S3", api: true, help: "из GET /v2/voices" },
  { id: "voice.audioUrl", group: "voice", label: "External audio URL", type: "text", default: "", stage: "S3", api: true, help: "для external_audio; mp3/wav из Unitool/Voicebox/Yandex/etc" },
  { id: "voice.language", group: "voice", label: "Язык", type: "text", default: "ru", stage: "S3", api: true },
  { id: "voice.speed", group: "voice", label: "Скорость", type: "number", default: 1.0, min: 0.5, max: 1.5, step: 0.05, stage: "S3", api: true },
  { id: "voice.pitch", group: "voice", label: "Тон (pitch)", type: "number", default: 0, min: -50, max: 50, step: 1, stage: "S3", api: true },
  { id: "voice.emotion", group: "voice", label: "Эмоция", type: "enum", options: VOICE_EMOTION, default: "Friendly", stage: "S3", api: true, help: "если голос поддерживает" },

  // render (S3)
  { id: "render.engine", group: "render", label: "Движок видео", type: "enum", options: VIDEO_ENGINE, default: "avatar_iv", stage: "S3", api: true, credits: "cinematic_seedance = 60 cr/шот (manual)" },
  { id: "render.aspectRatio", group: "render", label: "Соотношение сторон", type: "enum", options: ASPECT_RATIO, default: "9:16", stage: "S3", api: true },
  { id: "render.resolution", group: "render", label: "Разрешение", type: "enum", options: RESOLUTION, default: "720p", stage: "S3", api: true, credits: "free-план: потолок 720p" },
  { id: "render.captions", group: "render", label: "Субтитры", type: "boolean", default: false, stage: "S3", api: true },
  { id: "render.backgroundType", group: "render", label: "Фон", type: "enum", options: BACKGROUND_TYPE, default: "transparent", stage: "S3", api: true, help: "transparent → композ поверх product b-roll" },
  { id: "render.musicEnabled", group: "render", label: "Музыка", type: "boolean", default: false, stage: "S3", api: true },
  { id: "render.durationMode", group: "render", label: "Длительность", type: "enum", options: DURATION_MODE, default: "auto", stage: "S3", api: true },
  { id: "render.durationSec", group: "render", label: "Длительность, сек", type: "number", default: 3, min: 1, max: 300, step: 1, stage: "S3", api: true, help: "при durationMode=custom; 2–3 для face-intro" },
  { id: "render.template", group: "render", label: "Шаблон (id)", type: "text", default: "", stage: "S3", api: true, help: "пусто = без шаблона" },
  { id: "render.outputFormat", group: "render", label: "Формат", type: "enum", options: OUTPUT_FORMAT, default: "mp4", stage: "S3", api: true, help: "webm → прозрачный фон" },

  // motion (S3)
  { id: "motion.customMotionPrompt", group: "motion", label: "Motion prompt", type: "text", default: "casual, natural gestures, slight skepticism", stage: "S3", api: true },
  { id: "motion.enhanceMotionPrompt", group: "motion", label: "Улучшать motion prompt", type: "boolean", default: true, stage: "S3", api: true },
  { id: "motion.cameraPrompt", group: "motion", label: "Camera prompt (360°)", type: "text", default: "", stage: "S3", api: false, credits: "cinematic manual" },

  // broll (Cinematic / manual)
  { id: "broll.enabled", group: "broll", label: "Product b-roll", type: "boolean", default: false, stage: "S3", api: false, credits: "60 cr/шот, UI-only" },
  { id: "broll.shotPrompt", group: "broll", label: "Shot prompt (product)", type: "text", default: "", stage: "S3", api: false },

  // budget (config)
  { id: "budget.maxCreditsPerRun", group: "budget", label: "Лимит credits на прогон", type: "number", default: 50, min: 0, max: 100000, step: 1, stage: "config", api: true },
  { id: "budget.blockCinematicAuto", group: "budget", label: "Блокировать авто-Cinematic", type: "boolean", default: true, stage: "config", api: true },
] as const;

export const METRIC_GROUPS: readonly MetricGroup[] = ["identity", "voice", "render", "motion", "broll", "budget"];

// ── Доменная модель конфига (плоские группы 1:1 с registry dot-path) ──
export interface LookSpec {
  id: string;
  scene: string;
  prompt: string;
  orientation: Orientation;
  pose: Pose;
  referenceImageKeys?: string[];
  optional?: boolean;
  mode: "api" | "manual"; // manual → Cinematic в UI
  lookId?: string;        // проставляется после генерации
}

export interface BloggerConfig {
  identity: {
    name: string;
    source: IdentitySource;
    avatarGroupId: string;
    avatarLookId: string;
    age: Age;
    gender: Gender;
    ethnicity: Ethnicity;
    style: AvatarStyle;
    orientation: Orientation;
    pose: Pose;
    appearance: string;
    train: boolean;
    consentConfirmed: boolean;
    faceImageKeys: string[];
  };
  looks: LookSpec[];
  voice: { mode: VoiceMode; voiceId: string; audioUrl: string; language: string; speed: number; pitch: number; emotion: VoiceEmotion };
  render: {
    engine: VideoEngine;
    aspectRatio: AspectRatio;
    resolution: Resolution;
    captions: boolean;
    backgroundType: BackgroundType;
    musicEnabled: boolean;
    durationMode: DurationMode;
    durationSec: number;
    template: string;
    outputFormat: OutputFormat;
  };
  motion: { customMotionPrompt: string; enhanceMotionPrompt: boolean; cameraPrompt: string };
  broll: { enabled: boolean; shotPrompt: string };
  budget: { maxCreditsPerRun: number; blockCinematicAuto: boolean };
}

// 10 сцен «Alina» (§7 research) — nativeUGC, НЕ студийные Look Packs
export const DEFAULT_LOOKS: readonly LookSpec[] = [
  { id: "kitchen_daylight", scene: "кухня, дневной свет", prompt: "home kitchen, morning daylight from window, leaning on counter, selfie", orientation: "vertical", pose: "half_body", mode: "api" },
  { id: "bedroom_cardigan", scene: "спальня, кардиган", prompt: "cozy bedroom, soft light, knit cardigan", orientation: "vertical", pose: "half_body", mode: "api" },
  { id: "living_room_couch", scene: "диван в гостиной", prompt: "living-room couch, relaxed", orientation: "vertical", pose: "half_body", mode: "api" },
  { id: "bathroom_skincare", scene: "ванная/скинкер", prompt: "bathroom mirror area, skincare context, modest framing", orientation: "vertical", pose: "close_up", mode: "api" },
  { id: "store_aisle", scene: "магазин", prompt: "retail store aisle, shopping, phone selfie", orientation: "vertical", pose: "half_body", mode: "api" },
  { id: "desk_corner", scene: "уголок стола", prompt: "home desk corner, NO monitor, NO microphone, casual", orientation: "vertical", pose: "half_body", mode: "api" },
  { id: "hallway", scene: "прихожая", prompt: "apartment hallway/entryway, about to go out", orientation: "vertical", pose: "half_body", mode: "api" },
  { id: "window_closeup", scene: "у окна close-up", prompt: "close-up by a window, natural backlight", orientation: "vertical", pose: "close_up", mode: "api" },
  { id: "balcony", scene: "балкон (опц.)", prompt: "small balcony, daytime", orientation: "vertical", pose: "half_body", optional: true, mode: "api" },
  { id: "car_passenger", scene: "в машине (опц.)", prompt: "passenger seat of a parked car, daylight, casual", orientation: "vertical", pose: "close_up", optional: true, mode: "api" },
];

// Дефолтный конфиг «Alina» — собран из registry-дефолтов (см. buildDefaultConfig ниже)
export const DEFAULT_BLOGGER_CONFIG: BloggerConfig = {
  identity: {
    name: "Yoyo",
    source: "existing_look",
    avatarGroupId: "",
    avatarLookId: "",
    age: "Young Adult",
    gender: "Woman",
    ethnicity: "Unspecified",
    style: "Realistic",
    orientation: "vertical",
    pose: "half_body",
    appearance: DEFAULT_APPEARANCE,
    train: true,
    consentConfirmed: false,
    faceImageKeys: [],
  },
  looks: DEFAULT_LOOKS.map((l) => ({ ...l })),
  voice: { mode: "visual_only", voiceId: "", audioUrl: "", language: "ru", speed: 1.0, pitch: 0, emotion: "Friendly" },
  render: {
    engine: "avatar_iv",
    aspectRatio: "9:16",
    resolution: "720p",
    captions: false,
    backgroundType: "transparent",
    musicEnabled: false,
    durationMode: "auto",
    durationSec: 3,
    template: "",
    outputFormat: "mp4",
  },
  motion: { customMotionPrompt: "casual, natural gestures, slight skepticism", enhanceMotionPrompt: true, cameraPrompt: "" },
  broll: { enabled: false, shotPrompt: "" },
  budget: { maxCreditsPerRun: 50, blockCinematicAuto: true },
};

// ── Утилиты ──
export function describeMetrics(): readonly MetricDef[] {
  return METRIC_REGISTRY;
}

export function metricsByGroup(group: MetricGroup): MetricDef[] {
  return METRIC_REGISTRY.filter((m) => m.group === group);
}

export function getMetric(id: string): MetricDef | undefined {
  return METRIC_REGISTRY.find((m) => m.id === id);
}

// Разрешить dot-path (2 уровня) внутри BloggerConfig
export function getByPath(config: BloggerConfig, id: string): unknown {
  const [g, k] = id.split(".");
  const group = (config as unknown as Record<string, Record<string, unknown>>)[g];
  return group ? group[k] : undefined;
}

// Пиксельные размеры под aspect+resolution (для API dimension)
export function dimensionFor(aspect: AspectRatio, resolution: Resolution): { width: number; height: number } {
  const shortEdge = resolution === "4k" ? 2160 : resolution === "1080p" ? 1080 : 720;
  const ratio: Record<AspectRatio, [number, number]> = {
    "9:16": [9, 16],
    "16:9": [16, 9],
    "4:5": [4, 5],
    "1:1": [1, 1],
    auto: [9, 16],
  };
  const [rw, rh] = ratio[aspect];
  // короткая сторона = shortEdge; вычисляем длинную, округляем до чётного
  if (rw <= rh) {
    const width = shortEdge;
    const height = Math.round((shortEdge * rh) / rw / 2) * 2;
    return { width, height };
  }
  const height = shortEdge;
  const width = Math.round((shortEdge * rw) / rh / 2) * 2;
  return { width, height };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// Валидатор, управляемый реестром (без внешних зависимостей — zod не подключаем)
export function validateBloggerConfig(config: BloggerConfig): ValidationResult {
  const errors: string[] = [];

  for (const m of METRIC_REGISTRY) {
    const v = getByPath(config, m.id);
    if (m.type === "enum") {
      if (typeof v !== "string" || !m.options?.includes(v)) {
        errors.push(`${m.id}: ожидалось одно из [${m.options?.join(", ")}], получено ${JSON.stringify(v)}`);
      }
    } else if (m.type === "number") {
      if (typeof v !== "number" || Number.isNaN(v)) {
        errors.push(`${m.id}: ожидалось число, получено ${JSON.stringify(v)}`);
      } else {
        if (m.min !== undefined && v < m.min) errors.push(`${m.id}: ${v} < min ${m.min}`);
        if (m.max !== undefined && v > m.max) errors.push(`${m.id}: ${v} > max ${m.max}`);
      }
    } else if (m.type === "boolean") {
      if (typeof v !== "boolean") errors.push(`${m.id}: ожидался boolean, получено ${JSON.stringify(v)}`);
    } else if (m.type === "text") {
      if (typeof v !== "string") errors.push(`${m.id}: ожидалась строка`);
    } else if (m.type === "image_keys") {
      if (!Array.isArray(v)) errors.push(`${m.id}: ожидался массив image_keys`);
    }
  }

  // Кросс-полевые правила
  if (!Array.isArray(config.looks) || config.looks.length === 0) {
    errors.push("looks: нужен хотя бы один look");
  }
  if (config.render.durationMode === "custom" && !(config.render.durationSec > 0)) {
    errors.push("render.durationSec: при durationMode=custom нужна положительная длительность");
  }
  if (!config.identity.name.trim()) {
    errors.push("identity.name: нужно имя блогера");
  }
  if (config.identity.source === "existing_look" && !config.identity.avatarLookId.trim()) {
    errors.push("identity.avatarLookId: при source=existing_look нужен look id из /v3/avatars/looks");
  }
  if (config.voice.mode === "heygen_tts" && !config.voice.voiceId.trim()) {
    errors.push("voice.voiceId: нужен voice id при voice.mode=heygen_tts");
  }
  if (config.voice.mode === "external_audio" && !config.voice.audioUrl.trim()) {
    errors.push("voice.audioUrl: нужен audio URL при voice.mode=external_audio");
  }
  const needsFace = config.identity.source === "upload_own_face" || config.identity.source === "mixed";
  if (needsFace && !config.identity.consentConfirmed) {
    errors.push("identity.consentConfirmed: при заливке лица нужно подтверждение прав");
  }
  if (needsFace && config.identity.faceImageKeys.length === 0) {
    errors.push("identity.faceImageKeys: при source=upload/mixed нужны фото лица");
  }

  return { ok: errors.length === 0, errors };
}
