// HeyGen UGC-блогер — agent-tool (тот же источник правды, что и UI: heygenBlogger.ts).
// Даёт агенту/флоту: описание метрик, валидируемый patch конфига и маппинг в HeyGen API-запросы.
// Человек (панель) и агент дёргают ОДНИ И ТЕ ЖЕ функции → расхождений нет.
// Чистый модуль без сети. Спека: docs/factory-ugc-heygen-integration-spec.md
import {
  METRIC_REGISTRY,
  type MetricDef,
  type BloggerConfig,
  validateBloggerConfig,
  dimensionFor,
  getByPath,
  describeMetrics,
} from "./heygenBlogger";

// ── Tool-схема из реестра (для флота / function-calling) ──
export interface ToolParamSchema {
  type: "string" | "number" | "boolean" | "array";
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  description?: string;
}

function metricToParam(m: MetricDef): ToolParamSchema {
  if (m.type === "enum") return { type: "string", enum: m.options, description: m.label };
  if (m.type === "number") return { type: "number", minimum: m.min, maximum: m.max, description: m.label };
  if (m.type === "boolean") return { type: "boolean", description: m.label };
  if (m.type === "image_keys") return { type: "array", description: m.label };
  return { type: "string", description: m.label };
}

// Плоская схема: ключ = dot-path метрики, значение = JSON-schema-описание.
export function buildToolParameters(): Record<string, ToolParamSchema> {
  const props: Record<string, ToolParamSchema> = {};
  for (const m of METRIC_REGISTRY) props[m.id] = metricToParam(m);
  return props;
}

export const HEYGEN_BLOGGER_TOOL = {
  name: "configure_heygen_blogger",
  description:
    "Настроить UGC-блогера HeyGen по метрикам (лицо, look, голос, рендер, motion, бюджет). " +
    "Патч задаётся dot-path'ами метрик (напр. {\"render.aspectRatio\":\"9:16\",\"voice.speed\":1.1}). " +
    "Валидируется той же схемой, что и ручная панель.",
  parameters: {
    type: "object" as const,
    properties: buildToolParameters(),
    additionalProperties: false,
  },
  metrics: describeMetrics(),
} as const;

// ── Применить patch (одинаково для человека и агента) ──
export interface PatchResult {
  config: BloggerConfig;
  errors: string[];
  applied: string[];
  rejected: string[];
}

// Патч — плоский объект dot-path → value. Неизвестные ключи отклоняются.
export function applyBloggerPatch(base: BloggerConfig, patch: Record<string, unknown>): PatchResult {
  const next: BloggerConfig = structuredCloneSafe(base);
  const applied: string[] = [];
  const rejected: string[] = [];

  for (const [id, value] of Object.entries(patch)) {
    const metric = METRIC_REGISTRY.find((m) => m.id === id);
    if (!metric) {
      rejected.push(`${id}: неизвестная метрика`);
      continue;
    }
    const [g, k] = id.split(".");
    const group = (next as unknown as Record<string, Record<string, unknown>>)[g];
    if (!group) {
      rejected.push(`${id}: неизвестная группа`);
      continue;
    }
    group[k] = value;
    applied.push(id);
  }

  const validation = validateBloggerConfig(next);
  return { config: next, errors: [...rejected, ...validation.errors], applied, rejected };
}

function structuredCloneSafe<T>(v: T): T {
  const sc = (globalThis as { structuredClone?: <U>(x: U) => U }).structuredClone;
  return sc ? sc(v) : (JSON.parse(JSON.stringify(v)) as T);
}

// ── Маппинг конфига в тела запросов HeyGen (S1–S4) ──
// v3 catalog split is important: avatar groups are characters, avatar looks are the concrete video avatar_id.
export interface HeygenPayloads {
  identity:
    | { kind: "existing_look"; endpoint: string; body: { avatar_group_id?: string; avatar_look_id: string; name: string } }
    | { kind: "upload_group"; endpoint: string; body: { name: string; avatar_type: "photo" | "digital_twin"; image_keys: string[]; train: boolean } }
    | { kind: "prompt_generate"; endpoint: string; body: Record<string, unknown> };
  train: { endpoint: string; body: { group_id_ref: string } } | null;
  looks: Array<{ mode: "api" | "manual"; endpoint: string; body: Record<string, unknown> }>;
  video: { engine: string; endpoint: string; body: Record<string, unknown> };
  guards: { estCreditsNote: string; blockCinematicAuto: boolean };
}

export function configToHeygenPayloads(config: BloggerConfig): HeygenPayloads {
  const { identity, render, voice, motion, looks } = config;
  const dimension = dimensionFor(render.aspectRatio, render.resolution);

  const identityPayload: HeygenPayloads["identity"] =
    identity.source === "existing_look"
      ? {
          kind: "existing_look",
          endpoint: "GET /v3/avatars/looks/{look_id}",
          body: { name: identity.name, avatar_group_id: identity.avatarGroupId || undefined, avatar_look_id: identity.avatarLookId },
        }
      : identity.source === "prompt_design_ai"
      ? {
          kind: "prompt_generate",
          endpoint: "POST /v3/avatars",
          body: {
            name: identity.name,
            avatar_type: "prompt",
            age: identity.age,
            gender: identity.gender,
            ethnicity: identity.ethnicity,
            orientation: identity.orientation,
            pose: identity.pose,
            style: identity.style,
            appearance: identity.appearance,
          },
        }
      : {
          kind: "upload_group",
          endpoint: "POST /v3/avatars",
          body: { name: identity.name, avatar_type: identity.source === "mixed" ? "digital_twin" : "photo", image_keys: identity.faceImageKeys, train: identity.train },
        };

  const train = identity.train && identity.source !== "existing_look"
    ? { endpoint: "POST /v3/avatars (async training)", body: { group_id_ref: "<group_id>" } }
    : null;

  const looksPayload = looks.map((l) => ({
    mode: l.mode,
    endpoint: l.mode === "api" ? "POST /v3/avatars (create/look workflow; paid/manual confirmation)" : "MANUAL (HeyGen UI/Cinematic)",
    body: {
      group_id_ref: "<group_id>",
      prompt: l.prompt,
      orientation: l.orientation,
      pose: l.pose,
      image_keys: l.referenceImageKeys ?? [],
    },
  }));

  const background =
    render.backgroundType === "transparent"
      ? { type: "transparent" }
      : { type: render.backgroundType, value: "" };

  const videoBody: Record<string, unknown> =
    render.engine === "presenter_v"
      ? {
          type: "avatar",
          avatar_id: identity.avatarLookId || "<look_id>",
          title: identity.name,
          aspect_ratio: render.aspectRatio,
          engine: "avatar_iv",
          video_inputs: [
            {
              character: { type: "avatar", avatar_id: identity.avatarLookId || "<look_id>", avatar_style: "normal" },
              voice: {
                type: "text",
                input_text: "<script>",
                voice_id: voice.voiceId,
                speed: voice.speed,
                pitch: voice.pitch,
                emotion: voice.emotion,
              },
              background,
            },
          ],
          dimension,
          caption: render.captions,
        }
      : {
          type: "avatar",
          avatar_id: identity.avatarLookId || "<look_id>",
          title: identity.name,
          aspect_ratio: render.aspectRatio,
          engine: "avatar_iv",
          script: { type: "text", input: "<script>", voice_id: voice.voiceId },
          metadata: {
            custom_motion_prompt: motion.customMotionPrompt,
            enhance_custom_motion_prompt: motion.enhanceMotionPrompt,
            dimension,
          },
        };

  const video = {
    engine: render.engine,
    endpoint: "POST /v3/videos",
    body: videoBody,
  };

  return {
    identity: identityPayload,
    train,
    looks: looksPayload,
    video,
    guards: {
      estCreditsNote:
        render.engine === "presenter_v"
          ? "≈ 0.3 credit/сек"
          : render.engine === "cinematic_seedance"
          ? "60 credits/шот (manual)"
          : "Avatar IV ≈ $4/мин 1080p",
      blockCinematicAuto: config.budget.blockCinematicAuto,
    },
  };
}

// Быстрая проверка: можно ли пускать авто-генерацию без ручного подтверждения бюджета.
export function isAutoRunAllowed(config: BloggerConfig): { allowed: boolean; reason?: string } {
  if (config.render.engine === "cinematic_seedance" && config.budget.blockCinematicAuto) {
    return { allowed: false, reason: "Cinematic (60 cr/шот) заблокирован для авто-прогона (budget.blockCinematicAuto)" };
  }
  if (config.broll.enabled) {
    return { allowed: false, reason: "Product b-roll = ручной UI-режим (Cinematic)" };
  }
  const v = validateBloggerConfig(config);
  if (!v.ok) return { allowed: false, reason: `конфиг невалиден: ${v.errors[0]}` };
  return { allowed: true };
}

// re-export для потребителей, чтобы не тянуть два импорта
export { getByPath };
