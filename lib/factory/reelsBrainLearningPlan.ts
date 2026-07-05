type JsonRecord = Record<string, any>;
type FocusSegment = JsonRecord & {
  niche: string;
  platform: string;
  label: string;
  evidence_band: string;
  blockers: string[];
  stability_score: number;
  missing: boolean;
};

type PolicyRow = JsonRecord & {
  niche?: string;
  platform?: string;
  policy_mode?: string;
  label?: string;
  trust_band?: string;
  evidence_band?: string;
  readiness_score?: number;
  policy_reason?: string;
};

type LearningEconomicsSummary = {
  pattern_gain_cost_trend: string;
  pattern_gain_proxy_total: number;
  high_trust_gain_proxy_total: number;
  cost_units_per_pattern_gain_recent: number;
  weak_pattern_gain: boolean;
};

type OutcomeMemorySummary = {
  pattern_memory?: {
    no_feedback_queue?: Array<JsonRecord>;
    coverage_gaps?: JsonRecord;
    coverage_rate?: number;
  };
};

type ExactSegmentQueueSummary = {
  items?: Array<JsonRecord>;
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function evidenceRank(value: unknown) {
  const band = text(value, "missing");
  if (band === "missing") return 0;
  if (band === "thin") return 1;
  if (band === "forming") return 2;
  if (band === "stable") return 3;
  return 1;
}

function safeSegment(row: JsonRecord | null | undefined): FocusSegment | null {
  if (!row) return null;
  const niche = text(row.niche);
  const platform = text(row.platform);
  if (!niche || !platform) return null;
  return {
    ...row,
    niche,
    platform,
    label: text(row.label, `${niche} × ${platform}`),
    evidence_band: text(row.evidence_band, "missing"),
    blockers: Array.isArray(row.blockers) ? row.blockers.map((item) => text(item)).filter(Boolean).slice(0, 4) : [],
    stability_score: num(row.stability_score),
    missing: Boolean(row.missing),
  };
}

function safePolicyRow(row: JsonRecord | null | undefined): PolicyRow | null {
  if (!row) return null;
  const niche = text(row.niche);
  const platform = text(row.platform);
  const policyMode = text(row.policy_mode, "research_only");
  if (!policyMode) return null;
  return {
    ...row,
    ...(niche ? { niche } : {}),
    ...(platform ? { platform } : {}),
    policy_mode: policyMode,
    label: text(row.label, niche && platform ? `${niche} × ${platform}` : niche || platform || "policy segment"),
    trust_band: text(row.trust_band, "low"),
    evidence_band: text(row.evidence_band, "missing"),
    outcome_status: text(row.outcome_status, "no_feedback"),
    readiness_score: num(row.readiness_score),
    policy_reason: text(row.policy_reason),
  };
}

function safeLearningEconomics(row: JsonRecord | null | undefined): LearningEconomicsSummary {
  return {
    pattern_gain_cost_trend: text(row?.pattern_gain_cost_trend, "not_enough_data"),
    pattern_gain_proxy_total: num(row?.pattern_gain_proxy_total),
    high_trust_gain_proxy_total: num(row?.high_trust_gain_proxy_total),
    cost_units_per_pattern_gain_recent: num(row?.cost_units_per_pattern_gain_recent),
    weak_pattern_gain: Boolean(row?.weak_pattern_gain),
  };
}

function selectPolicyForSegment(
  generationPolicy: JsonRecord | null | undefined,
  segment: FocusSegment | null,
) {
  if (!segment) return null;
  const bySegment = Array.isArray(generationPolicy?.by_segment)
    ? (generationPolicy?.by_segment as JsonRecord[])
        .map((row) => safePolicyRow(row))
        .filter(Boolean) as PolicyRow[]
    : [];
  const exact = bySegment.find((row) => row.niche === segment.niche && row.platform === segment.platform);
  if (exact) return exact;

  const byNiche = Array.isArray(generationPolicy?.by_niche)
    ? (generationPolicy?.by_niche as JsonRecord[])
        .map((row) => safePolicyRow(row))
        .filter(Boolean) as PolicyRow[]
    : [];
  const nicheFallback = byNiche.find((row) => row.niche === segment.niche);
  if (nicheFallback) return nicheFallback;

  const byPlatform = Array.isArray(generationPolicy?.by_platform)
    ? (generationPolicy?.by_platform as JsonRecord[])
        .map((row) => safePolicyRow(row))
        .filter(Boolean) as PolicyRow[]
    : [];
  return byPlatform.find((row) => row.platform === segment.platform) || null;
}

export function pickPortfolioFocusSegment(portfolioReadiness?: JsonRecord | null) {
  const candidates = Array.isArray(portfolioReadiness?.missing_segments)
    ? (portfolioReadiness?.missing_segments as JsonRecord[])
        .map((row) => safeSegment(row))
        .filter(Boolean) as FocusSegment[]
    : [];

  return candidates
    .sort((a, b) =>
      Number(b.missing) - Number(a.missing)
      || evidenceRank(a.evidence_band) - evidenceRank(b.evidence_band)
      || a.stability_score - b.stability_score
      || b.blockers.length - a.blockers.length
      || a.label.localeCompare(b.label),
    )[0] || null;
}

export function buildReelsBrainNextTick(input: {
  target: number;
  totalVideos: number;
  analyzedVideos: number;
  backlogLimit: number;
  canRunPaidCollection: boolean;
  guardStatus?: string;
  prioritySegment?: JsonRecord | null;
  portfolioReadiness?: JsonRecord | null;
  generationPolicy?: JsonRecord | null;
  learningEconomics?: JsonRecord | null;
  outcomeMemory?: OutcomeMemorySummary | JsonRecord | null;
  exactSegmentQueue?: ExactSegmentQueueSummary | JsonRecord | null;
}) {
  const backlog = Math.max(0, input.totalVideos - input.analyzedVideos);
  const portfolio = (input.portfolioReadiness || {}) as JsonRecord;
  const portfolioSummary = (portfolio.summary || portfolio) as JsonRecord;
  const portfolioCoverage = num(portfolioSummary.high_trust_coverage_pct);
  const portfolioVerdict = text(portfolioSummary.verdict, "still_building");
  const learningEconomics = safeLearningEconomics(input.learningEconomics);
  const patternMemory = (input.outcomeMemory && typeof input.outcomeMemory === "object"
    ? ((input.outcomeMemory as OutcomeMemorySummary).pattern_memory || {})
    : {}) as JsonRecord;
  const noFeedbackQueue = Array.isArray(patternMemory.no_feedback_queue) ? patternMemory.no_feedback_queue as JsonRecord[] : [];
  const coverageGaps = (patternMemory.coverage_gaps && typeof patternMemory.coverage_gaps === "object")
    ? patternMemory.coverage_gaps as JsonRecord
    : {};
  const highConfidenceNoFeedback = num(coverageGaps.high_confidence_no_feedback);
  const totalNoFeedbackQueue = num(coverageGaps.total_no_feedback_queue || noFeedbackQueue.length);
  const feedbackCoverageRate = num(patternMemory.coverage_rate);
  const prioritySegment = safeSegment(input.prioritySegment);
  const portfolioFocusSegment = pickPortfolioFocusSegment(portfolio);
  const exactFocusSegment = safeSegment(
    records((input.exactSegmentQueue as ExactSegmentQueueSummary | null | undefined)?.items)[0] || null,
  );
  const collectionFocusSegment = exactFocusSegment || portfolioFocusSegment || prioritySegment;
  const directSegmentPolicy = selectPolicyForSegment(input.generationPolicy, prioritySegment);
  const directPolicyMode = text(directSegmentPolicy?.policy_mode, "research_only");
  const directOutcomeStatus = text((directSegmentPolicy as JsonRecord | null)?.outcome_status, "no_feedback");
  const shouldSupportDecisionSegment = prioritySegment?.action === "promote_segment_briefs"
    || prioritySegment?.action === "validate_segment_briefs"
    || directPolicyMode === "primary"
    || directPolicyMode === "control_only";
  const readinessBlockedDecisionSupport = Boolean(prioritySegment?.readiness_blocked);
  const marketBlockedDecisionSupport = directOutcomeStatus === "weak";
  const activePolicySegment = shouldSupportDecisionSegment ? prioritySegment : collectionFocusSegment || prioritySegment;
  const activePolicy = selectPolicyForSegment(input.generationPolicy, activePolicySegment);
  const activePolicyMode = text(activePolicy?.policy_mode, "research_only");
  const patternGainTrend = learningEconomics.pattern_gain_cost_trend;
  const expensivePatternGain = patternGainTrend === "more_expensive" || learningEconomics.weak_pattern_gain;
  const dynamicBacklogLimit = expensivePatternGain
    ? clamp(Math.round(input.backlogLimit * (learningEconomics.weak_pattern_gain ? 0.45 : 0.65)), 24, input.backlogLimit)
    : input.backlogLimit;
  const shouldAnalyzeForEconomics = backlog >= dynamicBacklogLimit && backlog > 0;
  const shouldImproveFeedbackCoverage = backlog < dynamicBacklogLimit
    && input.totalVideos >= Math.round(input.target * 0.85)
    && highConfidenceNoFeedback >= 2
    && feedbackCoverageRate < 75;

  if (shouldAnalyzeForEconomics) {
    return {
      task: "analyze_backlog",
      label: "Сначала разобрать накопленный backlog",
      reason: expensivePatternGain
        ? `В базе есть ${backlog} неразобранных видео, а economics уже ухудшилась (${patternGainTrend || "weak_pattern_gain"}). Сейчас выгоднее дожать анализ и pattern compaction, чем покупать новый сбор.${prioritySegment ? ` Главный сегмент тика: ${String(prioritySegment.label || "")}.` : ""}`
        : `В базе есть ${backlog} неразобранных видео. Дешевле превратить их в память, чем покупать новый сбор.${prioritySegment ? ` Главный сегмент тика: ${String(prioritySegment.label || "")}.` : ""}`,
      endpoint: "/api/factory/jobs/reels-brain-learning",
      params: {
        strategy: "analyze",
        limit: expensivePatternGain ? "100" : "80",
        ...(expensivePatternGain ? { build_patterns: "true" } : {}),
        ...(prioritySegment ? {
          niche: String(prioritySegment.niche || ""),
          platform: String(prioritySegment.platform || ""),
        } : {}),
      },
      paid_collection: false,
      priority_segment: prioritySegment,
      portfolio_priority_segment: portfolioFocusSegment,
      learning_economics: learningEconomics,
    };
  }

  if (shouldImproveFeedbackCoverage) {
    return {
      task: "improve_feedback_coverage",
      label: "Закрывать market-feedback у сильных паттернов",
      reason: `Корпус уже достаточно большой (${input.totalVideos}/${input.target}), но ${highConfidenceNoFeedback} high-confidence паттернов всё ещё без market proof. Следующий цикл лучше потратить на measurement loop, а не на слепой добор корпуса.`,
      endpoint: "/api/factory/reels-brain/autopilot-actions",
      params: {
        mode: "read_only",
        focus: "feedback_coverage",
        pattern_ids: noFeedbackQueue.slice(0, 3).map((row) => text(row.pattern_id)).filter(Boolean).join(","),
      },
      paid_collection: false,
      priority_segment: prioritySegment,
      portfolio_priority_segment: portfolioFocusSegment,
      learning_economics: learningEconomics,
      outcome_memory_focus: {
        high_confidence_no_feedback: highConfidenceNoFeedback,
        total_no_feedback_queue: totalNoFeedbackQueue,
        feedback_coverage_rate: feedbackCoverageRate,
      },
    };
  }

  if (!input.canRunPaidCollection) {
    return {
      task: "wait_or_repair_sources",
      label: "Платный сбор временно не трогать",
      reason: `Cost guard сейчас ${input.guardStatus || "watch"}: лучше чинить источники/анализ, а не жечь бюджет.`,
      endpoint: "/api/factory/reels-brain/autopilot-actions",
      params: { mode: "read_only" },
      paid_collection: false,
      priority_segment: prioritySegment,
      portfolio_priority_segment: portfolioFocusSegment,
      learning_economics: learningEconomics,
    };
  }

  if (input.totalVideos < input.target) {
    const shouldClosePortfolioGaps = (!shouldSupportDecisionSegment || marketBlockedDecisionSupport || readinessBlockedDecisionSupport) && portfolioCoverage < 70;
    const collectionSegment = shouldClosePortfolioGaps ? collectionFocusSegment : prioritySegment;
    const policyReason = text(activePolicy?.policy_reason);
    const policyLine = activePolicy
      ? ` Policy ${activePolicyMode}: ${policyReason || `${text(activePolicy.label)} · trust ${text(activePolicy.trust_band)} · evidence ${text(activePolicy.evidence_band)} · readiness ${num(activePolicy.readiness_score)}.`}`
      : "";

    return {
      task: shouldSupportDecisionSegment
        ? marketBlockedDecisionSupport || readinessBlockedDecisionSupport
          ? "collect_portfolio_gaps"
          : "collect_support_for_decision_segment"
        : shouldClosePortfolioGaps
          ? "collect_portfolio_gaps"
          : "collect_smart_batch",
      label: shouldSupportDecisionSegment
        ? marketBlockedDecisionSupport || readinessBlockedDecisionSupport
          ? collectionSegment
            ? readinessBlockedDecisionSupport
              ? `Сегмент ${String(prioritySegment?.label || "")} ещё сырой; закрывать дыру ${collectionSegment.label}`
              : `Не усиливать weak сегмент; закрывать дыру ${collectionSegment.label}`
            : readinessBlockedDecisionSupport
              ? "Сегмент ещё сырой; закрывать portfolio gaps"
              : "Не усиливать weak сегмент; закрывать portfolio gaps"
          : `Поддержать decision-ready сегмент ${String(prioritySegment?.label || "")}`
        : shouldClosePortfolioGaps
          ? collectionSegment
            ? `Закрывать дыру ${collectionSegment.label} в portfolio coverage`
            : "Закрывать дыры в portfolio coverage"
          : "Добрать новую умную пачку",
      reason: shouldSupportDecisionSegment
        ? marketBlockedDecisionSupport
          ? `${String(prioritySegment?.label || activePolicy?.label || "")} формально близок к decision-ready, но рынок уже даёт weak outcome; следующий сбор лучше не вливать в него, а закрывать другие gaps.${policyLine}`
          : readinessBlockedDecisionSupport
            ? `${String(prioritySegment?.label || activePolicy?.label || "")} силён по trust, но ещё не дозрел по learning-layer (${String(prioritySegment?.readiness_dominant_gap || "readiness")} backlog ${num(prioritySegment?.readiness_total_backlog)}). Сначала закрываем readiness gap и только потом усиливаем segment briefs.${policyLine}`
            : `${String(prioritySegment?.label || activePolicy?.label || "")} уже близок к рабочим briefs/hypotheses; следующий сбор лучше направить в этот сегмент.${policyLine}`
        : shouldClosePortfolioGaps
          ? collectionSegment
            ? `High-trust coverage матрицы пока ${portfolioCoverage}% (${portfolioVerdict}); следующий сбор направляем в сегмент ${collectionSegment.label}, потому что он ещё не закрыт по доверию.${policyLine}`
            : `High-trust coverage матрицы пока ${portfolioCoverage}% (${portfolioVerdict}); следующий сбор лучше тратить на незакрытые niches/platforms, а не на общий bulk.${policyLine}`
          : `Backlog под контролем, budget guard разрешает сбор, цель корпуса ещё не закрыта.${policyLine}`,
      endpoint: "/api/factory/jobs/reels-brain-cron",
      params: {
        task: "bulk",
        target: String(input.target),
        max_backlog_before_analyze: String(input.backlogLimit),
        ...(collectionSegment ? {
          niche: String(collectionSegment.niche || ""),
          platform: String(collectionSegment.platform || ""),
        } : {}),
      },
      paid_collection: true,
      priority_segment: prioritySegment,
      portfolio_priority_segment: portfolioFocusSegment,
      portfolio_readiness: portfolio,
      generation_policy: activePolicy,
      learning_economics: learningEconomics,
    };
  }

  return {
    task: "build_patterns",
    label: "Пересобрать Pattern Brain",
    reason: "Цель корпуса закрыта: следующий шаг — сжать данные в паттерны и creative briefs.",
    endpoint: "/api/factory/jobs/reels-brain-learning",
    params: { strategy: "analyze", build_patterns: "true" },
    paid_collection: false,
    priority_segment: prioritySegment,
    portfolio_priority_segment: portfolioFocusSegment,
    portfolio_readiness: portfolio,
    learning_economics: learningEconomics,
  };
}

export { clamp, num, text };
