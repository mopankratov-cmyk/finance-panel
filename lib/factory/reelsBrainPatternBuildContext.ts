import type { ReelsPatternSourceVideo } from "./reelsBrainPatterns";

type JsonRecord = Record<string, unknown>;

function rec(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function focusPlatformFromIntent(intent: unknown, niche: string) {
  const row = rec(intent);
  const label = text(row.focus_segment);
  const [focusNiche = "", focusPlatform = ""] = label.split("×").map((part) => part.trim().toLowerCase());
  if (!focusNiche || focusNiche !== niche.trim().toLowerCase()) return null;
  return focusPlatform || null;
}

function analyzedFullRichness(value: unknown): number {
  const row = rec(value);
  return Object.entries(row).reduce((sum, [key, entry]) => {
    if (!key) return sum;
    if (entry == null) return sum;
    if (typeof entry === "string") return sum + (entry.trim() ? 1 : 0);
    if (typeof entry === "number" || typeof entry === "boolean") return sum + 1;
    if (Array.isArray(entry)) return sum + (entry.length ? 1 : 0);
    if (typeof entry === "object") return sum + (Object.keys(rec(entry)).length ? 1 : 0);
    return sum;
  }, 0);
}

function evidenceRichness(row: ReelsPatternSourceVideo) {
  return [
    row.hook_text,
    row.caption,
    row.format_detected,
    row.sound_title,
    row.beat_structure,
    row.viral_reason,
  ].reduce((sum, value) => {
    if (value == null) return sum;
    if (typeof value === "string") return sum + (value.trim() ? 1 : 0);
    if (Array.isArray(value)) return sum + (value.length ? 1 : 0);
    if (typeof value === "object") return sum + (Object.keys(rec(value)).length ? 1 : 0);
    return sum + 1;
  }, 0);
}

function fieldFocusScore(row: ReelsPatternSourceVideo, fieldFocus: string, familyFocus: string) {
  const field = fieldFocus.toLowerCase();
  const family = familyFocus.toLowerCase();
  let score = 0;
  if (field.includes("hook") || family === "hook") {
    score += text(row.hook_text) ? 40 : 0;
  }
  if (field.includes("visual") || family === "visual") {
    score += text(row.format_detected) ? 25 : 0;
    score += text(row.caption) ? 10 : 0;
  }
  if (field.includes("struct") || family === "structure") {
    score += text(row.format_detected) ? 30 : 0;
    score += row.viral_reason ? 10 : 0;
  }
  if (field.includes("audio") || field.includes("beat") || field.includes("speech") || field.includes("transcript") || family === "audio") {
    score += row.beat_structure ? 35 : 0;
    score += text(row.sound_title) ? 15 : 0;
    score += analyzedFullRichness(row.analyzed_full) ? 10 : 0;
  }
  return score;
}

export type ReelsBrainPatternBuildContext = {
  focus_platform: string | null;
  source_discovery_mode: string | null;
  execution_mode: string | null;
  field_focus: string | null;
  family_focus: string | null;
  platform_biased: boolean;
  exact_proof_biased: boolean;
  brief_bundle_biased: boolean;
  ship_ready_biased: boolean;
  high_trust_generation_biased: boolean;
  output_ready_biased: boolean;
  requested_limit: number;
};

export function buildPatternBuildContext(input: {
  executionIntent?: unknown;
  niche: string;
  requestedLimit: number;
  sourceDiscoveryMode?: unknown;
  platform?: unknown;
}) : ReelsBrainPatternBuildContext {
  const executionIntent = rec(input.executionIntent);
  const intentFocusPlatform = focusPlatformFromIntent(executionIntent, input.niche);
  const focusPlatform = text(input.platform || intentFocusPlatform).toLowerCase() || null;
  const sourceDiscoveryMode = text(input.sourceDiscoveryMode || executionIntent.source_discovery_mode) || null;
  const executionMode = text(executionIntent.mode) || null;
  const fieldFocus = text(executionIntent.field_focus) || null;
  const familyFocus = text(executionIntent.family_focus) || null;
  const exactProofBiased = sourceDiscoveryMode === "close_exact_proof" || sourceDiscoveryMode === "pin_winner_provider";
  const briefBundleBiased = executionMode === "brief_bundle_completion";
  const shipReadyBiased = executionMode === "ship_ready_bundle_completion";
  const highTrustGenerationBiased = executionMode === "high_trust_generation_upgrade";
  const outputReadyBiased = briefBundleBiased || shipReadyBiased || highTrustGenerationBiased;

  return {
    focus_platform: focusPlatform,
    source_discovery_mode: sourceDiscoveryMode,
    execution_mode: executionMode,
    field_focus: fieldFocus,
    family_focus: familyFocus,
    platform_biased: Boolean(focusPlatform),
    exact_proof_biased: exactProofBiased,
    brief_bundle_biased: briefBundleBiased,
    ship_ready_biased: shipReadyBiased,
    high_trust_generation_biased: highTrustGenerationBiased,
    output_ready_biased: outputReadyBiased,
    requested_limit: input.requestedLimit,
  };
}

export function patternBuildFetchLimit(limit: number, context: ReelsBrainPatternBuildContext) {
  const multiplier = context.output_ready_biased ? 3 : context.platform_biased || context.exact_proof_biased ? 2 : 1;
  return Math.min(3000, Math.max(limit, limit * multiplier));
}

export function prioritizePatternSourceVideos(
  rows: ReelsPatternSourceVideo[],
  context: ReelsBrainPatternBuildContext,
  limit: number,
) {
  const focusPlatform = context.focus_platform || "";
  const sorted = [...rows].sort((a, b) => {
    const leftPlatformMatch = Number(text(a.platform).toLowerCase() === focusPlatform);
    const rightPlatformMatch = Number(text(b.platform).toLowerCase() === focusPlatform);
    const leftAnalyzedRichness = analyzedFullRichness(a.analyzed_full);
    const rightAnalyzedRichness = analyzedFullRichness(b.analyzed_full);
    const leftEvidence = evidenceRichness(a);
    const rightEvidence = evidenceRichness(b);
    const leftFieldFocus = fieldFocusScore(a, context.field_focus || "", context.family_focus || "");
    const rightFieldFocus = fieldFocusScore(b, context.field_focus || "", context.family_focus || "");
    const leftBase = num(a.virality_score);
    const rightBase = num(b.virality_score);
    const leftScore = leftBase
      + leftPlatformMatch * (context.exact_proof_biased ? 2000 : context.platform_biased ? 500 : 0)
      + leftAnalyzedRichness * (context.output_ready_biased ? 25 : 6)
      + leftEvidence * (context.output_ready_biased ? 10 : 3)
      + leftFieldFocus
      + (context.ship_ready_biased ? leftAnalyzedRichness * 10 : 0)
      + (context.high_trust_generation_biased ? leftAnalyzedRichness * 8 : 0)
      + (context.brief_bundle_biased ? leftAnalyzedRichness * 6 : 0);
    const rightScore = rightBase
      + rightPlatformMatch * (context.exact_proof_biased ? 2000 : context.platform_biased ? 500 : 0)
      + rightAnalyzedRichness * (context.output_ready_biased ? 25 : 6)
      + rightEvidence * (context.output_ready_biased ? 10 : 3)
      + rightFieldFocus
      + (context.ship_ready_biased ? rightAnalyzedRichness * 10 : 0)
      + (context.high_trust_generation_biased ? rightAnalyzedRichness * 8 : 0)
      + (context.brief_bundle_biased ? rightAnalyzedRichness * 6 : 0);
    return rightScore - leftScore
      || rightPlatformMatch - leftPlatformMatch
      || rightAnalyzedRichness - leftAnalyzedRichness
      || rightEvidence - leftEvidence
      || rightFieldFocus - leftFieldFocus
      || rightBase - leftBase;
  });
  return sorted.slice(0, limit);
}
