import { evaluateHookPolicy, type HookPolicyResult } from "./hookPolicy";
import { validateBlueprint, type Blueprint } from "./blueprint/schema";
import type { FactoryLane } from "./renderRouter";

type Row = Record<string, unknown>;

export interface ProducerBlueprintInput {
  article?: unknown;
  product_name?: unknown;
  hook?: unknown;
  scenario?: unknown;
  lane?: unknown;
  format?: unknown;
  canonical_frame_url?: unknown;
  source_asset_url?: unknown;
  hook_source?: unknown;
}

export interface ProducerBlueprintResult {
  blueprint: Blueprint | null;
  hook_policy: HookPolicyResult;
  valid: boolean;
  errors: string[];
}

function text(value: unknown, max = 1000): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function laneOf(value: unknown): FactoryLane {
  return value === "ugc" || value === "hybrid" ? value : "product";
}

function scenarioShots(value: unknown): Row[] {
  const obj = value && typeof value === "object" ? value as Row : {};
  const raw = Array.isArray(obj.shots) ? obj.shots : Array.isArray(obj.beats) ? obj.beats : [];
  return raw.filter((item): item is Row => !!item && typeof item === "object" && !Array.isArray(item)).slice(0, 8);
}

function shotText(shot: Row): string {
  return text(shot.visual || shot.shot || shot.scene || shot.description, 700);
}

function shotTime(shot: Row, idx: number): number {
  const raw = text(shot.t || shot.time || "");
  const match = raw.match(/\d+/);
  const n = match ? Number(match[0]) : idx * 3;
  return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : idx * 3;
}

export function buildProducerBlueprint(input: ProducerBlueprintInput): ProducerBlueprintResult {
  const article = text(input.article, 80);
  const product = text(input.product_name, 160);
  const sourceUrl = text(input.canonical_frame_url || input.source_asset_url, 1200);
  const scenario = input.scenario && typeof input.scenario === "object" ? input.scenario as Row : {};
  const hook = text(input.hook || scenario.hook || scenario.title || "");
  const hookPolicy = evaluateHookPolicy({
    text: hook,
    source: input.hook_source || "strong_prompt",
    locked: true,
    product,
  });
  const shots = scenarioShots(scenario);
  const fallbackShot = product || article ? `Живой товарный кадр: ${product || article}` : "Живой товарный кадр";
  const beats = (shots.length ? shots : [{ t: "0-3с", visual: fallbackShot }, { t: "3-8с", visual: "Показать пользу в реальном сценарии" }, { t: "8-15с", visual: "Финальный кадр с CTA" }]).map((shot, idx) => ({
    t: shotTime(shot, idx),
    shot: shotText(shot) || fallbackShot,
    ref: { kind: sourceUrl ? "canonical" as const : "asset" as const, ...(sourceUrl ? { url: sourceUrl } : {}) },
    motion: text(shot.motion || "slow product motion, no text warping", 300),
  }));

  const candidate = {
    sku_id: article || product,
    lane: laneOf(input.lane),
    format: text(input.format, 60) || "reel_9x16",
    duration_s: Math.max(6, Math.min(60, Number(scenario.duration_sec || scenario.duration_s || 18) || 18)),
    hook: { text: hook, source: input.hook_source === "human" ? "human" as const : "strong_prompt" as const, locked: true as const },
    beats,
    voiceover: text((scenario.shots as Row[] | undefined)?.map?.((s) => text(s.voiceover)).filter(Boolean).join(" ") || scenario.voiceover, 2000),
    captions: beats.map((beat, idx) => ({ t: beat.t, text: idx === 0 ? hook : text(shots[idx]?.onscreen, 180) })).filter((c) => c.text),
    music_mood: text(scenario.music || "commerce-safe trend sound", 120),
    cta: { text: text(scenario.cta || (article ? `Ищи артикул ${article} на WB` : "Сохрани, чтобы не потерять"), 180), t: Math.max(6, Math.min(60, Number(scenario.duration_sec || 18) || 18)) },
  };
  const checked = validateBlueprint(candidate);
  const errors = checked.ok ? [] : checked.errors;
  if (!sourceUrl) errors.push("canonical_frame_url is required for paid product lane");
  if (!hookPolicy.ok) errors.push(...hookPolicy.issues.map((issue) => `hook_policy:${issue}`));
  return {
    blueprint: checked.ok ? checked.blueprint : null,
    hook_policy: hookPolicy,
    valid: checked.ok && !!sourceUrl && hookPolicy.ok,
    errors,
  };
}
