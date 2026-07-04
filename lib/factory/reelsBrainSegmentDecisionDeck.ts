type BriefRow = {
  niche?: string;
  platform?: string;
  recommended_mode?: string;
  trust_score?: number;
  trust_status?: string;
  primary_allowed?: boolean;
  primary?: {
    title?: string;
    confidence?: string;
    op_score?: number;
    creative_brief?: {
      hook?: string;
      retention_mechanic?: string;
      second_by_second?: string[];
      visual_recipe?: string[];
      audio_strategy?: string[];
      product_fit?: string[];
      copy_as_mechanic?: string[];
      do_not_copy?: string[];
    };
    evidence?: {
      references?: number;
    };
  } | null;
};

type ActionRow = {
  niche?: string;
  platform?: string;
  recommended_mode?: string;
  primary?: {
    title?: string;
    decision?: "scale" | "control" | "watch" | string;
    priority_score?: number;
    success_metric?: string;
    guardrails?: string[];
    brief_seed?: {
      structure?: string;
    };
  } | null;
};

type HypothesisRow = {
  niche?: string;
  platform?: string;
  cards?: Array<{
    title?: string;
    hypothesis?: string;
    priority_score?: number;
    success_metric?: string;
  }>;
};

type PlaybookRow = {
  niche?: string;
  platform?: string;
  status?: "ship_now" | "validate_and_ship" | "prepare" | "research" | string;
  recommended_mode?: "primary" | "control_only" | "research_only" | string;
  opportunity_score?: number;
  stability_score?: number;
  stable_pattern_count?: number;
  coverage_rate?: number;
  rollout?: {
    why_now?: string;
    next_step?: string;
  };
};

type EvidenceRow = {
  niche?: string;
  platform?: string;
  evidence_status?: "high_trust" | "validated" | "corpus_strong_market_thin" | "research" | string;
  corpus_score?: number;
  market_score?: number;
  market_status?: string;
};

type AtlasRow = {
  niche?: string;
  platform?: string;
  status?: "stable" | "forming" | "thin" | string;
  avg_stability_score?: number;
  stable_pattern_count?: number;
  analyzed_videos?: number;
  total_videos?: number;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown, limit = 4): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function keyOf(niche: unknown, platform: unknown) {
  return `${text(niche)}__${text(platform)}`;
}

function confidenceBoost(value: string) {
  if (value === "high") return 10;
  if (value === "medium") return 5;
  return 0;
}

function evidenceBoost(value: string) {
  if (value === "high_trust") return 24;
  if (value === "validated") return 16;
  if (value === "corpus_strong_market_thin") return 10;
  return 0;
}

function modeBoost(value: string) {
  if (value === "primary") return 12;
  if (value === "control_only") return 6;
  return 0;
}

function atlasBoost(value: string) {
  if (value === "stable") return 12;
  if (value === "forming") return 6;
  return 0;
}

function decisionGrade(input: {
  score: number;
  evidenceStatus: string;
  playbookStatus: string;
  mode: string;
}) {
  if (input.score >= 82 && input.evidenceStatus === "high_trust" && (input.playbookStatus === "ship_now" || input.mode === "primary")) return "ship";
  if (input.score >= 66 && (input.evidenceStatus === "validated" || input.playbookStatus === "validate_and_ship")) return "validate";
  if (input.score >= 48 && (input.playbookStatus === "prepare" || input.evidenceStatus === "corpus_strong_market_thin")) return "prepare";
  return "research";
}

function generationMode(grade: string) {
  if (grade === "ship") return "decision_ready";
  if (grade === "validate") return "control_ready";
  if (grade === "prepare") return "brief_only";
  return "research_only";
}

export function buildReelsBrainSegmentDecisionDeck(input: {
  segmentOutputBanks?: {
    briefs?: BriefRow[];
    actions?: ActionRow[];
    hypotheses?: HypothesisRow[];
  };
  segmentPlaybook?: {
    items?: PlaybookRow[];
  };
  evidenceLedger?: {
    items?: EvidenceRow[];
  };
  patternAtlas?: {
    by_segment?: AtlasRow[];
  };
  limit?: number;
}) {
  const briefMap = new Map((input.segmentOutputBanks?.briefs || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const actionMap = new Map((input.segmentOutputBanks?.actions || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const hypothesisMap = new Map((input.segmentOutputBanks?.hypotheses || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const playbookMap = new Map((input.segmentPlaybook?.items || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const evidenceMap = new Map((input.evidenceLedger?.items || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const atlasMap = new Map((input.patternAtlas?.by_segment || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const keys = Array.from(new Set([
    ...briefMap.keys(),
    ...actionMap.keys(),
    ...hypothesisMap.keys(),
    ...playbookMap.keys(),
    ...evidenceMap.keys(),
    ...atlasMap.keys(),
  ]));

  const items = keys
    .map((key) => {
      const briefRow = briefMap.get(key) || {};
      const actionRow = actionMap.get(key) || {};
      const hypothesisRow = hypothesisMap.get(key) || {};
      const playbookRow = playbookMap.get(key) || {};
      const evidenceRow = evidenceMap.get(key) || {};
      const atlasRow = atlasMap.get(key) || {};
      const primaryBrief = briefRow.primary || null;
      const primaryAction = actionRow.primary || null;
      const primaryHypothesis = (hypothesisRow.cards || [])[0] || null;
      const niche = text(briefRow.niche || actionRow.niche || hypothesisRow.niche || playbookRow.niche || evidenceRow.niche || atlasRow.niche);
      const platform = text(briefRow.platform || actionRow.platform || hypothesisRow.platform || playbookRow.platform || evidenceRow.platform || atlasRow.platform);
      const mode = text(playbookRow.recommended_mode || briefRow.recommended_mode || actionRow.recommended_mode || "research_only");
      const evidenceStatus = text(evidenceRow.evidence_status || "research");
      const playbookStatus = text(playbookRow.status || "research");
      const score = clamp(
        num(briefRow.trust_score) * 0.18
        + num(evidenceRow.corpus_score) * 0.28
        + num(evidenceRow.market_score) * 0.14
        + num(playbookRow.opportunity_score) * 0.14
        + num(playbookRow.stability_score) * 0.12
        + num(primaryAction?.priority_score) * 0.06
        + num(primaryHypothesis?.priority_score) * 0.04
        + Math.min(6, num(primaryBrief?.evidence?.references))
        + confidenceBoost(text(primaryBrief?.confidence))
        + evidenceBoost(evidenceStatus)
        + modeBoost(mode)
        + atlasBoost(text(atlasRow.status)),
      );
      const grade = decisionGrade({ score, evidenceStatus, playbookStatus, mode });
      return {
        niche,
        platform,
        label: `${niche} × ${platform}`,
        trust_score: score,
        decision_grade: grade,
        generation_mode: generationMode(grade),
        ready_for_generation: grade === "ship" || grade === "validate",
        recommended_mode: mode,
        evidence_status: evidenceStatus,
        playbook_status: playbookStatus,
        atlas_status: text(atlasRow.status),
        corpus_score: num(evidenceRow.corpus_score),
        market_score: num(evidenceRow.market_score),
        opportunity_score: num(playbookRow.opportunity_score),
        stable_pattern_count: num(atlasRow.stable_pattern_count || playbookRow.stable_pattern_count),
        analyzed_videos: num(atlasRow.analyzed_videos),
        brief: {
          title: text(primaryBrief?.title),
          hook: text(primaryBrief?.creative_brief?.hook),
          retention: text(primaryBrief?.creative_brief?.retention_mechanic),
          second_by_second: list(primaryBrief?.creative_brief?.second_by_second, 4),
          visual_recipe: list(primaryBrief?.creative_brief?.visual_recipe, 3),
          audio_strategy: list(primaryBrief?.creative_brief?.audio_strategy, 3),
          product_fit: list(primaryBrief?.creative_brief?.product_fit, 3),
          copy_as_mechanic: list(primaryBrief?.creative_brief?.copy_as_mechanic, 3),
          do_not_copy: list(primaryBrief?.creative_brief?.do_not_copy, 3),
          evidence_refs: num(primaryBrief?.evidence?.references),
          confidence: text(primaryBrief?.confidence),
        },
        action: {
          title: text(primaryAction?.title),
          decision: text(primaryAction?.decision),
          success_metric: text(primaryAction?.success_metric),
          guardrails: list(primaryAction?.guardrails, 4),
          structure: text(primaryAction?.brief_seed?.structure),
        },
        hypothesis: {
          title: text(primaryHypothesis?.title),
          text: text(primaryHypothesis?.hypothesis),
          success_metric: text(primaryHypothesis?.success_metric),
        },
        generator_payload: {
          hook: text(primaryBrief?.creative_brief?.hook),
          retention: text(primaryBrief?.creative_brief?.retention_mechanic),
          structure: text(primaryAction?.brief_seed?.structure),
          visual_recipe: list(primaryBrief?.creative_brief?.visual_recipe, 3),
          audio_strategy: list(primaryBrief?.creative_brief?.audio_strategy, 3),
          product_fit: list(primaryBrief?.creative_brief?.product_fit, 3),
          copy_as_mechanic: list(primaryBrief?.creative_brief?.copy_as_mechanic, 3),
          do_not_copy: list(primaryBrief?.creative_brief?.do_not_copy, 3),
        },
        why_now: text(playbookRow.rollout?.why_now),
        next_step: text(playbookRow.rollout?.next_step),
      };
    })
    .filter((item) => item.niche && item.platform && (item.brief.title || item.action.title || item.hypothesis.title))
    .sort((a, b) =>
      b.trust_score - a.trust_score
      || Number(b.ready_for_generation) - Number(a.ready_for_generation)
      || b.stable_pattern_count - a.stable_pattern_count
      || b.opportunity_score - a.opportunity_score
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  return {
    summary: {
      total: items.length,
      ship: items.filter((item) => item.decision_grade === "ship").length,
      validate: items.filter((item) => item.decision_grade === "validate").length,
      prepare: items.filter((item) => item.decision_grade === "prepare").length,
      research: items.filter((item) => item.decision_grade === "research").length,
      ready_for_generation: items.filter((item) => item.ready_for_generation).length,
      decision_ready: items.filter((item) => item.generation_mode === "decision_ready").length,
      control_ready: items.filter((item) => item.generation_mode === "control_ready").length,
    },
    items: items.slice(0, Math.max(4, input.limit || 8)),
  };
}
