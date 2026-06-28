import type { FactoryLane } from "../renderRouter";

export interface BlueprintHook {
  text: string;
  source: "human" | "strong_prompt";
  locked: true;
}

export interface BlueprintBeat {
  t: number;
  shot: string;
  ref: { kind: "canonical" | "asset"; url?: string; asset_id?: number };
  motion: string;
}

export interface Blueprint {
  sku_id: string;
  lane: FactoryLane;
  format: string;
  duration_s: number;
  hook: BlueprintHook;
  beats: BlueprintBeat[];
  voiceover?: string;
  captions?: Array<{ t: number; text: string }>;
  music_mood?: string;
  cta?: { text: string; t: number };
}

export type BlueprintValidation =
  | { ok: true; blueprint: Blueprint; errors: [] }
  | { ok: false; blueprint: null; errors: string[] };

function text(value: unknown, max = 2000): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isLane(value: unknown): value is FactoryLane {
  return value === "product" || value === "ugc" || value === "hybrid";
}

export function validateBlueprint(input: unknown): BlueprintValidation {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, blueprint: null, errors: ["blueprint must be an object"] };
  }
  const raw = input as Record<string, unknown>;
  const skuId = text(raw.sku_id, 80);
  if (!skuId) errors.push("sku_id is required");
  const lane = isLane(raw.lane) ? raw.lane : null;
  if (!lane) errors.push("lane must be product|ugc|hybrid");
  const format = text(raw.format, 60) || "reel_9x16";
  const duration = finiteNumber(raw.duration_s);
  if (duration == null || duration < 6 || duration > 60) errors.push("duration_s must be 6..60");

  const hookRaw = raw.hook && typeof raw.hook === "object" ? raw.hook as Record<string, unknown> : null;
  const hookText = text(hookRaw?.text, 300);
  const hookSource = hookRaw?.source === "human" || hookRaw?.source === "strong_prompt" ? hookRaw.source : null;
  if (!hookText) errors.push("hook.text is required");
  if (!hookSource) errors.push("hook.source must be human|strong_prompt");
  if (hookRaw?.locked !== true) errors.push("hook.locked must be true");

  const beatsRaw = Array.isArray(raw.beats) ? raw.beats : [];
  if (!beatsRaw.length) errors.push("beats[] is required");
  const beats: BlueprintBeat[] = [];
  for (const [i, item] of beatsRaw.entries()) {
    const beatRaw = item && typeof item === "object" ? item as Record<string, unknown> : null;
    if (!beatRaw) {
      errors.push(`beats[${i}] must be an object`);
      continue;
    }
    const t = finiteNumber(beatRaw.t);
    const shot = text(beatRaw.shot, 700);
    const motion = text(beatRaw.motion, 300);
    const refRaw = beatRaw.ref && typeof beatRaw.ref === "object" ? beatRaw.ref as Record<string, unknown> : null;
    const refKind = refRaw?.kind === "canonical" || refRaw?.kind === "asset" ? refRaw.kind : null;
    const refUrl = text(refRaw?.url, 1200);
    const assetId = finiteNumber(refRaw?.asset_id);
    if (t == null || t < 0 || t > 60) errors.push(`beats[${i}].t must be 0..60`);
    if (!shot) errors.push(`beats[${i}].shot is required`);
    if (!motion) errors.push(`beats[${i}].motion is required`);
    if (!refKind) errors.push(`beats[${i}].ref.kind must be canonical|asset`);
    if (refKind === "canonical" && !refUrl) errors.push(`beats[${i}].ref.url is required for canonical ref`);
    beats.push({
      t: t ?? 0,
      shot,
      motion,
      ref: { kind: refKind || "canonical", ...(refUrl ? { url: refUrl } : {}), ...(assetId != null ? { asset_id: assetId } : {}) },
    });
  }

  if (errors.length || !lane || !hookSource || duration == null) return { ok: false, blueprint: null, errors };
  return {
    ok: true,
    blueprint: {
      sku_id: skuId,
      lane,
      format,
      duration_s: duration,
      hook: { text: hookText, source: hookSource, locked: true },
      beats,
      ...(text(raw.voiceover, 2000) ? { voiceover: text(raw.voiceover, 2000) } : {}),
      ...(Array.isArray(raw.captions) ? { captions: raw.captions.map((c) => ({ t: finiteNumber((c as Record<string, unknown>)?.t) ?? 0, text: text((c as Record<string, unknown>)?.text, 220) })).filter((c) => c.text).slice(0, 12) } : {}),
      ...(text(raw.music_mood, 120) ? { music_mood: text(raw.music_mood, 120) } : {}),
      ...(raw.cta && typeof raw.cta === "object" && text((raw.cta as Record<string, unknown>).text, 180)
        ? { cta: { text: text((raw.cta as Record<string, unknown>).text, 180), t: finiteNumber((raw.cta as Record<string, unknown>).t) ?? duration } }
        : {}),
    },
    errors: [],
  };
}

export function repairBlueprint(input: unknown): Blueprint | null {
  try {
    const raw = typeof input === "string" ? JSON.parse(input) : input;
    const validated = validateBlueprint(raw);
    return validated.ok ? validated.blueprint : null;
  } catch {
    return null;
  }
}
