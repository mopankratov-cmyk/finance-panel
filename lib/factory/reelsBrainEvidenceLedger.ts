type PlaybookItem = {
  niche?: string;
  platform?: string;
  status?: "ship_now" | "validate_and_ship" | "prepare" | "research" | string;
  recommended_mode?: "primary" | "control_only" | "research_only" | string;
  opportunity_score?: number;
  stability_score?: number;
  stable_pattern_count?: number;
  coverage_rate?: number;
  leading_pattern?: {
    title?: string;
    hook?: string;
    retention?: string;
    format?: string;
    decision?: string;
    market_status?: "proven" | "promising" | "weak" | "no_feedback" | string;
    brief_seed?: {
      hook?: string;
      retention?: string;
      visual_recipe?: string[];
      audio_strategy?: string[];
      product_fit?: string[];
      do_not_copy?: string[];
    };
  };
  brief?: {
    title?: string;
    hook?: string;
  };
  hypothesis?: {
    title?: string;
    text?: string;
  };
  rollout?: {
    title?: string;
    why_now?: string;
    next_step?: string;
  };
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function modeRank(mode: string) {
  if (mode === "primary") return 3;
  if (mode === "control_only") return 2;
  return 1;
}

function marketScore(status: string) {
  if (status === "proven") return 88;
  if (status === "promising") return 62;
  if (status === "weak") return 24;
  return 8;
}

function trustStatus(corpus: number, market: number, mode: string) {
  if (corpus >= 78 && market >= 72 && mode === "primary") return "high_trust";
  if (corpus >= 62 && market >= 38) return "validated";
  if (corpus >= 58) return "corpus_strong_market_thin";
  return "research";
}

export function buildReelsBrainEvidenceLedger(input: {
  segmentPlaybook?: { items?: PlaybookItem[] };
  limit?: number;
}) {
  const items = (input.segmentPlaybook?.items || [])
    .map((item) => {
      const corpusScore = clamp(
        num(item.opportunity_score) * 0.5
        + num(item.stability_score) * 0.32
        + Math.min(12, num(item.coverage_rate) * 0.12)
        + Math.min(10, num(item.stable_pattern_count) * 2),
      );
      const marketStatus = text(item.leading_pattern?.market_status || "no_feedback");
      const marketTrust = marketScore(marketStatus);
      const evidenceStatus = trustStatus(corpusScore, marketTrust, text(item.recommended_mode));
      return {
        niche: text(item.niche),
        platform: text(item.platform),
        label: `${text(item.niche)} × ${text(item.platform)}`,
        evidence_status: evidenceStatus,
        recommended_mode: text(item.recommended_mode),
        corpus_score: corpusScore,
        market_score: marketTrust,
        market_status: marketStatus,
        opportunity_score: num(item.opportunity_score),
        stability_score: num(item.stability_score),
        stable_pattern_count: num(item.stable_pattern_count),
        coverage_rate: num(item.coverage_rate),
        brief_title: text(item.brief?.title),
        brief_hook: text(item.brief?.hook || item.leading_pattern?.hook),
        hypothesis_title: text(item.hypothesis?.title),
        hypothesis: text(item.hypothesis?.text),
        rollout_title: text(item.rollout?.title),
        why_now: text(item.rollout?.why_now),
        next_step: text(item.rollout?.next_step),
        leading_pattern_title: text(item.leading_pattern?.title),
        leading_pattern_retention: text(item.leading_pattern?.retention),
        leading_pattern_format: text(item.leading_pattern?.format),
      };
    })
    .sort((a, b) =>
      modeRank(b.recommended_mode) - modeRank(a.recommended_mode)
      || b.corpus_score - a.corpus_score
      || b.market_score - a.market_score
      || b.stable_pattern_count - a.stable_pattern_count
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  return {
    summary: {
      total: items.length,
      high_trust: items.filter((item) => item.evidence_status === "high_trust").length,
      validated: items.filter((item) => item.evidence_status === "validated").length,
      corpus_strong_market_thin: items.filter((item) => item.evidence_status === "corpus_strong_market_thin").length,
      research: items.filter((item) => item.evidence_status === "research").length,
      proven_market_segments: items.filter((item) => item.market_status === "proven").length,
      promising_market_segments: items.filter((item) => item.market_status === "promising").length,
    },
    items: items.slice(0, Math.max(4, input.limit || 8)),
  };
}
