import type { ReelsBrainCronExecutionIntent } from "./reelsBrainCronExecutionIntent";

type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function focusSegment(intent: ReelsBrainCronExecutionIntent | null | undefined) {
  const label = text(intent?.focus_segment);
  const [niche = "", platform = ""] = label.split("×").map((part) => part.trim());
  return { niche, platform };
}

function sameSegment(
  intent: ReelsBrainCronExecutionIntent | null | undefined,
  lane: { niche: string; platform: string },
) {
  const focus = focusSegment(intent);
  return Boolean(focus.niche && focus.platform && focus.niche === lane.niche && focus.platform === lane.platform);
}

export function tuneAnalyzeLaneByExecutionIntent(input: {
  intent: ReelsBrainCronExecutionIntent | null;
  lane: { niche: string; platform: "tiktok" | "instagram" | "youtube"; unanalyzed: number };
  analyzeLimit: number;
  buildPatterns: boolean;
}) {
  const focused = sameSegment(input.intent, input.lane);
  const mode = input.intent?.mode || "generic_analyze";
  let analyzeLimit = input.analyzeLimit;
  let buildPatterns = input.buildPatterns;
  let taxonomyLimit = Math.max(12, Math.min(50, analyzeLimit * 4));
  let patternLimit = 600;
  let focusPlatform: string | null = null;
  let strategy = "generic_analyze";

  if ((mode === "support_primary_segment" || mode === "pattern_compaction") && focused) {
    strategy = mode === "pattern_compaction" ? "pattern_compaction" : "support_primary_segment";
    analyzeLimit = Math.max(6, Math.min(analyzeLimit, 10, input.lane.unanalyzed));
    buildPatterns = true;
    taxonomyLimit = Math.max(16, Math.min(36, analyzeLimit * 3));
    patternLimit = 360;
    focusPlatform = input.lane.platform;
  } else if (mode === "support_control_segment" && focused) {
    strategy = "support_control_segment";
    analyzeLimit = Math.max(8, Math.min(analyzeLimit, 12, input.lane.unanalyzed));
    buildPatterns = true;
    taxonomyLimit = Math.max(20, Math.min(42, analyzeLimit * 3));
    patternLimit = 420;
    focusPlatform = input.lane.platform;
  } else if (mode === "close_exact_segment_gap" && focused) {
    strategy = "close_exact_segment_gap";
    analyzeLimit = Math.max(8, Math.min(analyzeLimit, 10, input.lane.unanalyzed));
    buildPatterns = true;
    taxonomyLimit = Math.max(18, Math.min(30, analyzeLimit * 3));
    patternLimit = 300;
    focusPlatform = input.lane.platform;
  } else if (mode === "close_portfolio_gap" && focused) {
    strategy = "close_portfolio_gap";
    analyzeLimit = Math.max(8, Math.min(analyzeLimit, 14, input.lane.unanalyzed));
    buildPatterns = true;
    taxonomyLimit = Math.max(20, Math.min(48, analyzeLimit * 3));
    patternLimit = 480;
    focusPlatform = input.lane.platform;
  } else if (input.intent?.policy_mode === "research_only") {
    strategy = "explore_research_segment";
    analyzeLimit = Math.max(8, Math.min(Math.max(analyzeLimit, 14), input.lane.unanalyzed));
    taxonomyLimit = Math.max(20, Math.min(50, analyzeLimit * 4));
    patternLimit = 720;
  }

  return {
    strategy,
    analyze_limit: analyzeLimit,
    build_patterns: buildPatterns,
    taxonomy_limit: taxonomyLimit,
    pattern_limit: patternLimit,
    focus_platform: focusPlatform,
  };
}

export function summarizeAnalyzeExecutionIntent(intent: ReelsBrainCronExecutionIntent | null) {
  return intent
    ? {
      mode: intent.mode,
      policy_mode: intent.policy_mode,
      focus_segment: intent.focus_segment,
      explanation: intent.explanation,
      analyze_overrides: intent.analyze_overrides || null,
    }
    : null;
}

export function parseAnalyzeExecutionIntent(value: unknown): ReelsBrainCronExecutionIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as JsonRecord;
  const task = text(row.task);
  if (task !== "bulk" && task !== "analyze") return null;
  const policyMode = text(row.policy_mode, "research_only");
  return {
    mode: text(row.mode, "generic_analyze") as ReelsBrainCronExecutionIntent["mode"],
    task,
    focus_segment: text(row.focus_segment) || null,
    policy_mode: policyMode === "primary" || policyMode === "control_only" ? policyMode : "research_only",
    explanation: text(row.explanation),
    bulk_overrides: row.bulk_overrides && typeof row.bulk_overrides === "object" && !Array.isArray(row.bulk_overrides)
      ? row.bulk_overrides as NonNullable<ReelsBrainCronExecutionIntent["bulk_overrides"]>
      : undefined,
    analyze_overrides: row.analyze_overrides && typeof row.analyze_overrides === "object" && !Array.isArray(row.analyze_overrides)
      ? row.analyze_overrides as NonNullable<ReelsBrainCronExecutionIntent["analyze_overrides"]>
      : undefined,
  };
}
