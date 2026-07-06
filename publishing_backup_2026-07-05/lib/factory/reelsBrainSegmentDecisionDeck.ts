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
    memory_context?: {
      rebuild_alignment?: {
        status?: string;
        score?: number;
        reasons?: string[];
      } | null;
      rebuild_context?: {
        execution_mode?: string | null;
        focus_platform?: string | null;
      } | null;
      memory_note?: string;
    } | null;
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
    memory_context?: {
      rebuild_alignment?: {
        status?: string;
        score?: number;
        reasons?: string[];
      } | null;
      rebuild_context?: {
        execution_mode?: string | null;
        focus_platform?: string | null;
      } | null;
      memory_note?: string;
    } | null;
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
  proof_quality?: "exact_segment" | "traced_transfer_only" | "untraced" | string;
  exact_segment_posts?: number;
  traced_posts?: number;
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

type SegmentOutcomeRow = {
  segment?: string;
  niche?: string;
  platform?: string;
  posts?: number;
  views?: number;
  winners?: number;
  losers?: number;
  orders?: number;
  revenue?: number;
  avg_completion_rate?: number | null;
  avg_ctr?: number | null;
  status?: "proven" | "promising" | "weak" | "no_feedback" | string;
  proof_quality?: "exact_segment" | "traced_transfer_only" | "untraced" | string;
  exact_segment_posts?: number;
  traced_posts?: number;
  trust_action?: string;
  evidence?: string;
};

type SegmentPriorityRow = {
  niche?: string;
  platform?: string;
  decision_priority_score?: number;
  urgency_score?: number;
  ready_for_generation?: boolean;
  policy_mode?: string;
  recommended_upgrade?: {
    projected_trust_gain_score?: number;
    projected_production_state?: string;
    unlocked_output?: string;
  } | null;
};

type SegmentPolicyRow = {
  niche?: string;
  platform?: string;
  policy_mode?: string;
  trust_band?: string;
  evidence_band?: string;
  high_trust_generation_ready?: boolean;
  proof_quality?: string;
  publishable_exact?: boolean;
  outcome_status?: string;
  outcome_confidence?: string;
  policy_reason?: string;
  decision_priority_score?: number;
  recommended_upgrade?: {
    projected_trust_gain_score?: number;
    projected_production_state?: string;
    unlocked_output?: string;
  } | null;
  next_upgrade?: {
    projected_trust_gain_score?: number;
    projected_production_state?: string;
    unlocked_output?: string;
  } | null;
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

function outcomeBoost(value: string) {
  if (value === "proven") return 18;
  if (value === "promising") return 8;
  if (value === "weak") return -18;
  return 0;
}

function outcomeConfidence(posts: number, winners: number) {
  if (posts >= 6 || winners >= 3) return "high";
  if (posts >= 3 || winners >= 1) return "medium";
  if (posts > 0) return "low";
  return "none";
}

function normalizeProofQuality(value: unknown) {
  const raw = text(value);
  if (raw === "exact_segment") return "exact_segment";
  if (raw === "traced_transfer_only") return "traced_transfer_only";
  return "untraced";
}

function memoryContext(input: {
  brief?: BriefRow["primary"] | null;
  action?: ActionRow["primary"] | null;
}) {
  const source = input.action?.memory_context || input.brief?.memory_context || null;
  return {
    rebuild_alignment: source?.rebuild_alignment ? {
      status: text(source.rebuild_alignment.status, "unknown"),
      score: num(source.rebuild_alignment.score),
      reasons: list(source.rebuild_alignment.reasons, 4),
    } : null,
    rebuild_context: source?.rebuild_context ? {
      execution_mode: text(source.rebuild_context.execution_mode),
      focus_platform: text(source.rebuild_context.focus_platform),
    } : null,
    memory_note: text(source?.memory_note),
  };
}

function decisionGrade(input: {
  score: number;
  evidenceStatus: string;
  playbookStatus: string;
  mode: string;
  outcomeStatus: string;
  proofQuality: string;
}) {
  if (input.outcomeStatus === "weak" && input.score < 82) return "research";
  if (input.score >= 82 && input.evidenceStatus === "high_trust" && (input.playbookStatus === "ship_now" || input.mode === "primary")) return "ship";
  if (
    input.score >= 74
    && input.outcomeStatus === "proven"
    && input.proofQuality === "exact_segment"
    && (input.playbookStatus === "ship_now" || input.mode === "primary")
  ) return "ship";
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

function policyModeScore(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "primary") return 3;
  if (raw === "control_only") return 2;
  return 1;
}

function segmentPrioritySignal(
  niche: string,
  platform: string,
  segmentPriorityMap: Map<string, SegmentPriorityRow>,
  segmentPolicyMap: Map<string, SegmentPolicyRow>,
) {
  const key = `${niche}__${platform}`;
  const priority = segmentPriorityMap.get(key);
  const policy = segmentPolicyMap.get(key);
  const upgrade = policy?.recommended_upgrade || policy?.next_upgrade || priority?.recommended_upgrade || null;
  return {
    segment_priority_score: Math.max(
      num(priority?.decision_priority_score),
      num(priority?.urgency_score),
      num(policy?.decision_priority_score),
      num(upgrade?.projected_trust_gain_score),
    ),
    segment_priority_mode: text(priority?.policy_mode || policy?.policy_mode) || "research_only",
    segment_ready_for_generation: Boolean(priority?.ready_for_generation),
    trust_band: text(policy?.trust_band || "unknown"),
    evidence_band: text(policy?.evidence_band || "unknown"),
    high_trust_generation_ready: Boolean(policy?.high_trust_generation_ready),
    publishable_exact: Boolean(policy?.publishable_exact),
    proof_quality: text(policy?.proof_quality || "untraced"),
    policy_reason: text(policy?.policy_reason),
    projected_trust_gain_score: num(upgrade?.projected_trust_gain_score),
    projected_production_state: text(upgrade?.projected_production_state),
    unlocked_output: text(upgrade?.unlocked_output),
  };
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
  feedbackLoop?: {
    by_segment?: SegmentOutcomeRow[];
    segment_outcome_memory?: {
      strongest_segments?: SegmentOutcomeRow[];
      promising_segments?: SegmentOutcomeRow[];
      weak_segments?: SegmentOutcomeRow[];
      trust_update_queue?: Array<{
        segment?: string;
        status?: string;
        trust_action?: string;
        evidence?: string;
      }>;
    };
  };
  limit?: number;
  segmentPriorityQueue?: SegmentPriorityRow[];
  generationPolicy?: {
    by_segment?: SegmentPolicyRow[];
  } | null;
}) {
  const briefMap = new Map((input.segmentOutputBanks?.briefs || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const actionMap = new Map((input.segmentOutputBanks?.actions || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const hypothesisMap = new Map((input.segmentOutputBanks?.hypotheses || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const playbookMap = new Map((input.segmentPlaybook?.items || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const evidenceMap = new Map((input.evidenceLedger?.items || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const atlasMap = new Map((input.patternAtlas?.by_segment || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const feedbackRows = input.feedbackLoop?.by_segment
    || [
      ...(input.feedbackLoop?.segment_outcome_memory?.strongest_segments || []),
      ...(input.feedbackLoop?.segment_outcome_memory?.promising_segments || []),
      ...(input.feedbackLoop?.segment_outcome_memory?.weak_segments || []),
    ];
  const outcomeMap = new Map((feedbackRows || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const trustActionMap = new Map((input.feedbackLoop?.segment_outcome_memory?.trust_update_queue || []).map((row) => [text(row.segment), row] as const));
  const segmentPriorityMap = new Map((input.segmentPriorityQueue || []).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const segmentPolicyMap = new Map((((input.generationPolicy?.by_segment) || []) as SegmentPolicyRow[]).map((row) => [keyOf(row.niche, row.platform), row] as const));
  const keys = Array.from(new Set([
    ...briefMap.keys(),
    ...actionMap.keys(),
    ...hypothesisMap.keys(),
    ...playbookMap.keys(),
    ...evidenceMap.keys(),
    ...atlasMap.keys(),
    ...outcomeMap.keys(),
  ]));

  const items = keys
    .map((key) => {
      const briefRow = briefMap.get(key) || {};
      const actionRow = actionMap.get(key) || {};
      const hypothesisRow = hypothesisMap.get(key) || {};
      const playbookRow = playbookMap.get(key) || {};
      const evidenceRow = evidenceMap.get(key) || {};
      const atlasRow = atlasMap.get(key) || {};
      const outcomeRow = outcomeMap.get(key) || {};
      const primaryBrief = briefRow.primary || null;
      const primaryAction = actionRow.primary || null;
      const primaryHypothesis = (hypothesisRow.cards || [])[0] || null;
      const niche = text(briefRow.niche || actionRow.niche || hypothesisRow.niche || playbookRow.niche || evidenceRow.niche || atlasRow.niche);
      const platform = text(briefRow.platform || actionRow.platform || hypothesisRow.platform || playbookRow.platform || evidenceRow.platform || atlasRow.platform);
      const segmentLabel = `${niche} × ${platform}`;
      const mode = text(playbookRow.recommended_mode || briefRow.recommended_mode || actionRow.recommended_mode || "research_only");
      const evidenceStatus = text(evidenceRow.evidence_status || "research");
      const playbookStatus = text(playbookRow.status || "research");
      const outcomeStatus = text(outcomeRow.status || evidenceRow.market_status || "no_feedback");
      const proofQuality = normalizeProofQuality(outcomeRow.proof_quality || evidenceRow.proof_quality);
      const queuedOutcome = trustActionMap.get(segmentLabel) || null;
      const priority = segmentPrioritySignal(niche, platform, segmentPriorityMap, segmentPolicyMap);
      const memory = memoryContext({
        brief: primaryBrief,
        action: primaryAction,
      });
      const resolvedProofQuality = priority.proof_quality && priority.proof_quality !== "untraced"
        ? priority.proof_quality
        : proofQuality;
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
        + atlasBoost(text(atlasRow.status))
        + outcomeBoost(outcomeStatus)
        + (proofQuality === "exact_segment" ? 8 : proofQuality === "traced_transfer_only" ? 2 : -6)
      );
      const grade = decisionGrade({ score, evidenceStatus, playbookStatus, mode, outcomeStatus, proofQuality });
      return {
        niche,
        platform,
        label: segmentLabel,
        trust_score: score,
        segment_priority_score: priority.segment_priority_score,
        segment_priority_mode: priority.segment_priority_mode,
        segment_ready_for_generation: priority.segment_ready_for_generation,
        trust_band: priority.trust_band || "unknown",
        evidence_band: priority.evidence_band || "unknown",
        high_trust_generation_ready: priority.high_trust_generation_ready,
        publishable_exact: priority.publishable_exact,
        policy_reason: priority.policy_reason || "",
        projected_trust_gain_score: priority.projected_trust_gain_score,
        projected_production_state: priority.projected_production_state,
        unlocked_output: priority.unlocked_output,
        decision_grade: grade,
        generation_mode: generationMode(grade),
        ready_for_generation: (grade === "ship" || grade === "validate") && outcomeStatus !== "weak",
        recommended_mode: mode,
        evidence_status: evidenceStatus,
        playbook_status: playbookStatus,
        atlas_status: text(atlasRow.status),
        outcome_status: outcomeStatus,
        proof_quality: resolvedProofQuality,
        outcome_confidence: outcomeConfidence(num(outcomeRow.posts), num(outcomeRow.winners)),
        outcome_boost: outcomeBoost(outcomeStatus),
        outcome_posts: num(outcomeRow.posts),
        outcome_exact_segment_posts: num(outcomeRow.exact_segment_posts || evidenceRow.exact_segment_posts),
        outcome_traced_posts: num(outcomeRow.traced_posts || evidenceRow.traced_posts),
        outcome_winners: num(outcomeRow.winners),
        outcome_losers: num(outcomeRow.losers),
        outcome_orders: num(outcomeRow.orders),
        outcome_revenue: num(outcomeRow.revenue),
        outcome_avg_completion_rate: num(outcomeRow.avg_completion_rate),
        outcome_avg_ctr: num(outcomeRow.avg_ctr),
        outcome_trust_action: text(outcomeRow.trust_action || queuedOutcome?.trust_action),
        outcome_evidence: text(queuedOutcome?.evidence || outcomeRow.evidence),
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
        memory_context: memory,
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
        why_now: [
          text(playbookRow.rollout?.why_now),
          text(priority.policy_reason),
          resolvedProofQuality === "exact_segment" ? "Сегмент подтверждён exact-proof слоем." : "",
          resolvedProofQuality === "traced_transfer_only" ? "Есть только transfer-level proof, поэтому нужен ещё один точный validation pass." : "",
          resolvedProofQuality === "untraced" && outcomeStatus !== "no_feedback" ? "Outcome уже есть, но он ещё не оформлен как доказательный validation trace." : "",
          outcomeStatus === "proven" ? "Сегмент уже подтвержден outcome-постами." : "",
          outcomeStatus === "promising" ? "Появились первые market outcome сигналы, можно валидировать дальше." : "",
          outcomeStatus === "weak" ? "Рынок пока не подтверждает сегмент, нужен пересмотр before scaling." : "",
        ].filter(Boolean).join(" "),
        next_step: [
          text(playbookRow.rollout?.next_step),
          resolvedProofQuality !== "exact_segment" && outcomeStatus !== "weak" ? "Добрать exact-segment proof перед переводом в fully decision-ready lane." : "",
          outcomeStatus === "proven" ? "Поднимать в основной generation lane и масштабировать вариации." : "",
          outcomeStatus === "promising" ? "Сделать controlled test, чтобы добрать winner/loser signal." : "",
          outcomeStatus === "weak" ? "Пересобрать hook/structure и не пускать в основной lane." : "",
        ].filter(Boolean).join(" "),
      };
    })
    .filter((item) => item.niche && item.platform && (item.brief.title || item.action.title || item.hypothesis.title))
    .sort((a, b) =>
      policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
      || Number(Boolean(b.high_trust_generation_ready)) - Number(Boolean(a.high_trust_generation_ready))
      || Number(Boolean(b.publishable_exact)) - Number(Boolean(a.publishable_exact))
      || Number(b.proof_quality === "exact_segment") - Number(a.proof_quality === "exact_segment")
      || b.segment_priority_score - a.segment_priority_score
      || b.trust_score - a.trust_score
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
      primary_priority_segments: items.filter((item) => item.segment_priority_mode === "primary").length,
      decision_ready: items.filter((item) => item.generation_mode === "decision_ready").length,
      control_ready: items.filter((item) => item.generation_mode === "control_ready").length,
      exact_proof_ready: items.filter((item) => item.proof_quality === "exact_segment").length,
      generation_ready: items.filter((item) => item.high_trust_generation_ready).length,
      proven_outcomes: items.filter((item) => item.outcome_status === "proven").length,
      weak_outcomes: items.filter((item) => item.outcome_status === "weak").length,
      rebuild_alignment: items[0]?.memory_context?.rebuild_alignment || null,
      memory_note: text(items[0]?.memory_context?.memory_note),
    },
    items: items.slice(0, Math.max(4, input.limit || 8)),
  };
}
