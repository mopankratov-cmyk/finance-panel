import { normalizeTargetPlatform } from "./reelsBrainPlaybook";

export interface SourceRunLearningInput {
  found?: unknown;
  relevant?: unknown;
  inserted?: unknown;
  remembered_provider?: unknown;
  learned_provider?: unknown;
  target_platform?: unknown;
  provider_runs?: unknown;
  segment_outcome_status?: unknown;
  segment_outcome_confidence?: unknown;
  query?: unknown;
  recommended_queries?: unknown;
}

export interface SourceRunRetryPlan {
  retry_provider: string | null;
  pin_provider: boolean;
  reasons: string[];
}

export interface SourceRunHealthReport {
  target_platform: "tiktok" | "instagram" | "youtube";
  found: number;
  relevant: number;
  inserted: number;
  remembered_provider: string | null;
  learned_provider: string | null;
  winner_changed: boolean;
  low_yield: boolean;
  empty_result: boolean;
  should_relearn: boolean;
  segment_outcome_status: "proven" | "promising" | "weak" | "no_feedback";
  segment_outcome_confidence: "high" | "medium" | "low" | "none";
  reasons: string[];
}

export interface SourceRunQueryPivotPlan {
  retry_query: string | null;
  reasons: string[];
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortFormPlatform(value: unknown): "tiktok" | "instagram" | "youtube" {
  const platform = normalizeTargetPlatform(value);
  return platform === "instagram" || platform === "youtube" ? platform : "tiktok";
}

function outcomeStatus(value: unknown): "proven" | "promising" | "weak" | "no_feedback" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "proven" || raw === "promising" || raw === "weak") return raw;
  return "no_feedback";
}

function outcomeConfidence(value: unknown): "high" | "medium" | "low" | "none" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "none";
}

export function assessSourceRunHealth(
  input: SourceRunLearningInput,
  thresholds?: { min_found?: number; min_relevant?: number; min_inserted?: number },
): SourceRunHealthReport {
  const found = num(input.found);
  const relevant = num(input.relevant);
  const inserted = num(input.inserted);
  const remembered = String(input.remembered_provider || "").trim().toLowerCase() || null;
  const learned = String(input.learned_provider || "").trim().toLowerCase() || null;
  const segmentStatus = outcomeStatus(input.segment_outcome_status);
  const segmentConfidence = outcomeConfidence(input.segment_outcome_confidence);
  const minFound = Math.max(1, num(thresholds?.min_found ?? 5));
  const minRelevantBase = Math.max(1, num(thresholds?.min_relevant ?? 3));
  const minInsertedBase = Math.max(0, num(thresholds?.min_inserted ?? 2));
  const minRelevant = segmentStatus === "weak"
    ? minRelevantBase + 1
    : segmentStatus === "proven"
      ? Math.max(1, minRelevantBase - 1)
      : minRelevantBase;
  const minInserted = segmentStatus === "weak"
    ? minInsertedBase + 1
    : segmentStatus === "proven"
      ? Math.max(0, minInsertedBase - 1)
      : minInsertedBase;
  const reasons: string[] = [];

  const winnerChanged = !!remembered && !!learned && remembered !== learned;
  const emptyResult = found < 1 || relevant < 1;
  const lowYield = found < minFound || relevant < minRelevant || inserted < minInserted;

  if (winnerChanged) reasons.push(`winner changed: ${remembered} -> ${learned}`);
  if (emptyResult) reasons.push("empty or irrelevant intake");
  else if (lowYield) reasons.push(`low yield: found=${found}, relevant=${relevant}, inserted=${inserted}`);
  if (segmentStatus === "weak") reasons.push("segment outcome is weak, so discovery should refresh assumptions faster");
  if (segmentStatus === "proven") reasons.push("segment outcome is proven, so healthy sources get a little more tolerance");

  return {
    target_platform: shortFormPlatform(input.target_platform),
    found,
    relevant,
    inserted,
    remembered_provider: remembered,
    learned_provider: learned,
    winner_changed: winnerChanged,
    low_yield: lowYield,
    empty_result: emptyResult,
    should_relearn: winnerChanged || emptyResult || lowYield,
    segment_outcome_status: segmentStatus,
    segment_outcome_confidence: segmentConfidence,
    reasons,
  };
}

export function chooseRetryProviderPlan(
  input: SourceRunLearningInput,
  options?: {
    should_relearn?: boolean;
    bake_off_provider?: unknown;
  },
): SourceRunRetryPlan {
  const remembered = String(input.remembered_provider || "").trim().toLowerCase() || null;
  const learned = String(input.learned_provider || "").trim().toLowerCase() || null;
  const baked = String(options?.bake_off_provider || "").trim().toLowerCase() || null;
  const shouldRelearn = options?.should_relearn !== false;
  const reasons: string[] = [];

  if (!shouldRelearn) {
    return { retry_provider: null, pin_provider: false, reasons };
  }

  if (baked && baked !== remembered) {
    reasons.push(`bake-off winner selected: ${baked}`);
    return { retry_provider: baked, pin_provider: true, reasons };
  }

  if (learned && learned !== remembered) {
    reasons.push(`source-run winner selected: ${learned}`);
    return { retry_provider: learned, pin_provider: true, reasons };
  }

  return { retry_provider: null, pin_provider: false, reasons };
}

export function chooseRetryQueryPivot(
  input: SourceRunLearningInput,
  options?: { should_relearn?: boolean },
): SourceRunQueryPivotPlan {
  const shouldRelearn = options?.should_relearn !== false;
  const currentQuery = String(input.query || "").trim();
  const segmentStatus = outcomeStatus(input.segment_outcome_status);
  const queries = Array.isArray(input.recommended_queries)
    ? input.recommended_queries.map((row) => String(row || "").trim()).filter(Boolean)
    : [];
  const alternative = queries.find((query) => query && query !== currentQuery) || null;
  const reasons: string[] = [];

  if (!shouldRelearn || !alternative) {
    return { retry_query: null, reasons };
  }

  if (segmentStatus === "weak") {
    reasons.push(`segment is weak, pivot query from ${currentQuery || "current"} to ${alternative}`);
    return { retry_query: alternative, reasons };
  }

  return { retry_query: null, reasons };
}
