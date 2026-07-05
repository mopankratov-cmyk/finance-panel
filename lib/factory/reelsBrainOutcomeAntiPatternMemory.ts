import { buildReelsBrainOutcomeGuardrails } from "./reelsBrainOutcomeGuardrails";

type SegmentOutcomeRow = {
  segment?: string;
  niche?: string;
  platform?: string;
  status?: "proven" | "promising" | "weak" | "no_feedback" | string;
  posts?: number;
  winners?: number;
  losers?: number;
  trust_action?: string;
  evidence?: string;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

export function buildReelsBrainOutcomeAntiPatternMemory(input: {
  feedbackLoop?: {
    by_segment?: SegmentOutcomeRow[];
    segment_outcome_memory?: {
      weak_segments?: SegmentOutcomeRow[];
      promising_segments?: SegmentOutcomeRow[];
    };
  } | null;
  patternOutcomeMemory?: {
    decaying_patterns?: Array<{
      pattern_id?: string;
      title?: string;
      quality_gate?: string;
      total_posts?: number;
      winners?: number;
      losers?: number;
      best_segment?: string | null;
      trust_write?: string;
    }>;
    promotion_queue?: Array<{
      pattern_id?: string;
      title?: string;
      quality_gate?: string;
      total_posts?: number;
      winners?: number;
      losers?: number;
      best_segment?: string | null;
      trust_write?: string;
    }>;
  } | null;
  limit?: number;
}) {
  const directRows = Array.isArray(input.feedbackLoop?.by_segment) ? input.feedbackLoop?.by_segment || [] : [];
  const weakRows = directRows.length
    ? directRows.filter((row) => text(row.status) === "weak")
    : input.feedbackLoop?.segment_outcome_memory?.weak_segments || [];
  const promisingRows = directRows.length
    ? directRows.filter((row) => text(row.status) === "promising")
    : input.feedbackLoop?.segment_outcome_memory?.promising_segments || [];

  const rows = [
    ...weakRows.map((row) => {
      const guardrails = buildReelsBrainOutcomeGuardrails({
        outcome_status: row.status,
        outcome_posts: row.posts,
        outcome_winners: row.winners,
        outcome_losers: row.losers,
        outcome_trust_action: row.trust_action,
        outcome_evidence: row.evidence,
        platform: row.platform,
      });
      return {
        code: `weak_segment_${text(row.niche)}_${text(row.platform)}`,
        label: `Weak segment outcome: ${text(row.segment, `${row.niche} × ${row.platform}`)}`,
        evidence: row.evidence || `${num(row.winners)} winners / ${num(row.posts)} posts · losers ${num(row.losers)}`,
        action: text(guardrails.guardrails[0], text(row.trust_action, "review_or_penalize_segment")),
        severity: num(row.losers) >= 2 ? "high" : "medium",
        source: "segment_outcome_memory",
      };
    }),
    ...promisingRows.map((row) => {
      const guardrails = buildReelsBrainOutcomeGuardrails({
        outcome_status: row.status,
        outcome_posts: row.posts,
        outcome_winners: row.winners,
        outcome_losers: row.losers,
        outcome_trust_action: row.trust_action,
        outcome_evidence: row.evidence,
        platform: row.platform,
      });
      return {
        code: `promising_segment_${text(row.niche)}_${text(row.platform)}`,
        label: `Outcome still forming: ${text(row.segment, `${row.niche} × ${row.platform}`)}`,
        evidence: row.evidence || `${num(row.winners)} winners / ${num(row.posts)} posts`,
        action: text(guardrails.guardrails[0], text(row.trust_action, "keep_validating_segment")),
        severity: "medium",
        source: "segment_outcome_memory",
      };
    }),
    ...((input.patternOutcomeMemory?.decaying_patterns || []).map((row) => ({
      code: `weak_pattern_${text(row.pattern_id)}`,
      label: `Weak pattern outcome: ${text(row.title, text(row.pattern_id, "pattern"))}`,
      evidence: `${num(row.winners)} winners / ${num(row.total_posts)} posts · losers ${num(row.losers)}${text(row.best_segment) ? ` · ${text(row.best_segment)}` : ""}`,
      action: text(row.trust_write, "degrade_pattern_priority"),
      severity: num(row.losers) >= 2 ? "high" : "medium",
      source: "pattern_outcome_memory",
    }))),
    ...((input.patternOutcomeMemory?.promotion_queue || []).map((row) => ({
      code: `promising_pattern_${text(row.pattern_id)}`,
      label: `Pattern still validating: ${text(row.title, text(row.pattern_id, "pattern"))}`,
      evidence: `${num(row.winners)} winners / ${num(row.total_posts)} posts${text(row.best_segment) ? ` · ${text(row.best_segment)}` : ""}`,
      action: text(row.trust_write, "keep_validating_pattern"),
      severity: "medium",
      source: "pattern_outcome_memory",
    }))),
  ]
    .filter((row) => row.label && row.action)
    .sort((a, b) =>
      (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1)
      || a.label.localeCompare(b.label)
    )
    .slice(0, Math.max(3, input.limit || 6));

  return {
    count: rows.length,
    items: rows,
    summary: rows.length
      ? "Outcome memory уже пишет слабые и формирующиеся сегменты обратно в anti-pattern слой."
      : "Outcome anti-pattern writeback пока пуст: ждём segment feedback.",
  };
}
