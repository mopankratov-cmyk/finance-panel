type GenerationPackRow = {
  niche?: string;
  platform?: string;
  label?: string;
  readiness_score?: number;
  ready_for_generation?: boolean;
  decision_grade?: string;
  generation_mode?: string;
  quality_gate?: {
    status?: "ready" | "needs_validation" | "not_ready" | string;
    min_trust_score?: number;
    min_corpus_score?: number;
    min_market_score?: number;
    min_stable_patterns?: number;
    min_evidence_refs?: number;
    blocked_reasons?: string[];
  };
  evidence_status?: string;
  corpus_score?: number;
  market_score?: number;
  stable_pattern_count?: number;
  evidence_refs?: number;
  brief_title?: string;
  hypothesis_title?: string;
  action_title?: string;
  why_now?: string;
  next_step?: string;
  segment_priority_score?: number;
  segment_priority_mode?: string;
  segment_ready_for_generation?: boolean;
  projected_trust_gain_score?: number;
  projected_production_state?: string;
  unlocked_output?: string;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function list(value: unknown, limit = 5): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function verdict(status: string) {
  if (status === "ready") return "ship";
  if (status === "needs_validation") return "validate";
  return "research";
}

function policyModeScore(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "primary") return 3;
  if (raw === "control_only") return 2;
  return 1;
}

export function buildReelsBrainSegmentReadinessAudit(input: {
  segmentGenerationPacks?: {
    items?: GenerationPackRow[];
  };
  limit?: number;
}) {
  const items = (input.segmentGenerationPacks?.items || [])
    .map((row) => {
      const gateStatus = text(row.quality_gate?.status, "not_ready");
      const currentTrust = num(row.readiness_score);
      const currentCorpus = num(row.corpus_score);
      const currentMarket = num(row.market_score);
      const currentStable = num(row.stable_pattern_count);
      const currentEvidence = num(row.evidence_refs);
      const gapTrust = Math.max(0, num(row.quality_gate?.min_trust_score) - currentTrust);
      const gapCorpus = Math.max(0, num(row.quality_gate?.min_corpus_score) - currentCorpus);
      const gapMarket = Math.max(0, num(row.quality_gate?.min_market_score) - currentMarket);
      const gapStable = Math.max(0, num(row.quality_gate?.min_stable_patterns) - currentStable);
      const gapEvidence = Math.max(0, num(row.quality_gate?.min_evidence_refs) - currentEvidence);
      const strongSignals = [
        currentTrust >= num(row.quality_gate?.min_trust_score) ? "trust score уже проходит gate" : "",
        currentCorpus >= num(row.quality_gate?.min_corpus_score) ? "корпус сегмента достаточно плотный" : "",
        currentStable >= num(row.quality_gate?.min_stable_patterns) ? "есть устойчивые stable patterns" : "",
        currentEvidence >= num(row.quality_gate?.min_evidence_refs) ? "есть reference evidence" : "",
        text(row.evidence_status) === "high_trust" ? "сегмент подтвержден и корпусом, и рынком" : "",
      ].filter(Boolean);
      return {
        niche: text(row.niche),
        platform: text(row.platform),
        label: text(row.label || `${row.niche} × ${row.platform}`),
        verdict: verdict(gateStatus),
        segment_priority_score: num(row.segment_priority_score),
        segment_priority_mode: text(row.segment_priority_mode, "research_only"),
        segment_ready_for_generation: Boolean(row.segment_ready_for_generation),
        projected_trust_gain_score: num(row.projected_trust_gain_score),
        projected_production_state: text(row.projected_production_state),
        unlocked_output: text(row.unlocked_output),
        quality_gate_status: gateStatus,
        readiness_score: currentTrust,
        ready_for_generation: Boolean(row.ready_for_generation),
        strong_signals: strongSignals.slice(0, 4),
        blockers: list(row.quality_gate?.blocked_reasons, 5),
        gaps: {
          trust_score: gapTrust,
          corpus_score: gapCorpus,
          market_score: gapMarket,
          stable_patterns: gapStable,
          evidence_refs: gapEvidence,
        },
        current: {
          trust_score: currentTrust,
          corpus_score: currentCorpus,
          market_score: currentMarket,
          stable_patterns: currentStable,
          evidence_refs: currentEvidence,
        },
        targets: {
          trust_score: num(row.quality_gate?.min_trust_score),
          corpus_score: num(row.quality_gate?.min_corpus_score),
          market_score: num(row.quality_gate?.min_market_score),
          stable_patterns: num(row.quality_gate?.min_stable_patterns),
          evidence_refs: num(row.quality_gate?.min_evidence_refs),
        },
        exports_ready: {
          brief: text(row.brief_title),
          hypothesis: text(row.hypothesis_title),
          action: text(row.action_title),
        },
        why_now: text(row.why_now),
        next_step: text(row.next_step),
      };
    })
    .sort((a, b) =>
      policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
      || b.segment_priority_score - a.segment_priority_score
      || Number(b.ready_for_generation) - Number(a.ready_for_generation)
      || b.readiness_score - a.readiness_score
      || a.label.localeCompare(b.label),
    );

  return {
    summary: {
      total: items.length,
      ship: items.filter((item) => item.verdict === "ship").length,
      validate: items.filter((item) => item.verdict === "validate").length,
      research: items.filter((item) => item.verdict === "research").length,
      primary_priority_segments: items.filter((item) => item.segment_priority_mode === "primary").length,
      avg_readiness_score: items.length ? Math.round(items.reduce((sum, item) => sum + item.readiness_score, 0) / items.length) : 0,
    },
    ship_now: items.filter((item) => item.verdict === "ship").slice(0, Math.max(2, Math.min(6, input.limit || 8))),
    validate_next: items.filter((item) => item.verdict === "validate").slice(0, Math.max(2, Math.min(6, input.limit || 8))),
    research_queue: items.filter((item) => item.verdict === "research").slice(0, Math.max(2, Math.min(6, input.limit || 8))),
    items: items.slice(0, Math.max(4, input.limit || 8)),
  };
}
