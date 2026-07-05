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

type BriefCoverageAuditSummary = {
  gap_queue?: Array<JsonRecord>;
  summary?: JsonRecord | null;
};

type ShipReadyQueueSummary = {
  items?: Array<JsonRecord>;
  top_ship_candidates?: Array<JsonRecord>;
  summary?: JsonRecord | null;
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

function sameSegment(
  left: { niche?: string; platform?: string } | null | undefined,
  right: { niche?: string; platform?: string } | null | undefined,
) {
  return text(left?.niche) !== ""
    && text(left?.niche) === text(right?.niche)
    && text(left?.platform) !== ""
    && text(left?.platform) === text(right?.platform);
}

function exactSourceParams(segment: FocusSegment | null) {
  if (!segment) return {};
  const preferredProvider = text(segment.source_provider);
  const discoveryMode = text(segment.source_discovery_mode);
  const providerReason = text(segment.source_provider_reason);
  return {
    ...(preferredProvider ? { preferred_provider: preferredProvider } : {}),
    ...(discoveryMode ? { source_discovery_mode: discoveryMode } : {}),
    ...(providerReason ? { source_provider_reason: providerReason } : {}),
  };
}

function firstGapFocus(row: JsonRecord | null | undefined) {
  const fields = Array.isArray(row?.missing_fields) ? row?.missing_fields.map((item) => text(item)).filter(Boolean) : [];
  const families = Array.isArray(row?.missing_field_families) ? row?.missing_field_families.map((item) => text(item)).filter(Boolean) : [];
  return {
    field: fields[0] || "",
    family: families[0] || "",
    fields,
    families,
  };
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

function pickPublishableExactFocusSegment(input: {
  portfolioReadiness?: JsonRecord | null;
  generationPolicy?: JsonRecord | null;
  segmentPriorityQueue?: { items?: Array<JsonRecord> } | JsonRecord | null;
}) {
  const candidates = Array.isArray(input.portfolioReadiness?.publishable_exact_gaps)
    ? (input.portfolioReadiness?.publishable_exact_gaps as JsonRecord[])
        .map((row) => safeSegment(row))
        .filter(Boolean) as FocusSegment[]
    : [];
  const policyRows = Array.isArray(input.generationPolicy?.by_segment)
    ? (input.generationPolicy?.by_segment as JsonRecord[])
        .map((row) => safePolicyRow(row))
        .filter(Boolean) as PolicyRow[]
    : [];
  const priorityRows = records((input.segmentPriorityQueue as { items?: Array<JsonRecord> } | JsonRecord | null | undefined)?.items);
  const policyMap = new Map(policyRows.map((row) => [`${row.niche || ""}__${row.platform || ""}`, row] as const));
  const priorityMap = new Map(priorityRows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));

  return candidates
    .sort((a, b) => {
      const leftPolicy = policyMap.get(`${a.niche}__${a.platform}`) || null;
      const rightPolicy = policyMap.get(`${b.niche}__${b.platform}`) || null;
      const leftPriority = (priorityMap.get(`${a.niche}__${a.platform}`) || {}) as JsonRecord;
      const rightPriority = (priorityMap.get(`${b.niche}__${b.platform}`) || {}) as JsonRecord;
      const leftPolicyRank = text(leftPolicy?.policy_mode) === "primary" ? 3 : text(leftPolicy?.policy_mode) === "control_only" ? 2 : 1;
      const rightPolicyRank = text(rightPolicy?.policy_mode) === "primary" ? 3 : text(rightPolicy?.policy_mode) === "control_only" ? 2 : 1;
      const leftReadiness = Math.max(num(leftPolicy?.readiness_score), num(leftPriority.readiness_analyzed_rate));
      const rightReadiness = Math.max(num(rightPolicy?.readiness_score), num(rightPriority.readiness_analyzed_rate));
      return Number(Boolean(b.high_trust_segment)) - Number(Boolean(a.high_trust_segment))
        || evidenceRank(b.evidence_band) - evidenceRank(a.evidence_band)
        || rightPolicyRank - leftPolicyRank
        || rightReadiness - leftReadiness
        || num(rightPriority.urgency_score) - num(leftPriority.urgency_score)
        || b.stability_score - a.stability_score
        || a.blockers.length - b.blockers.length
        || a.label.localeCompare(b.label);
    })[0] || null;
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
  segmentPriorityQueue?: { items?: Array<JsonRecord> } | JsonRecord | null;
  learningEconomics?: JsonRecord | null;
  outcomeMemory?: OutcomeMemorySummary | JsonRecord | null;
  exactSegmentQueue?: ExactSegmentQueueSummary | JsonRecord | null;
  briefCoverageAudit?: BriefCoverageAuditSummary | JsonRecord | null;
  shipReadyQueue?: ShipReadyQueueSummary | JsonRecord | null;
}) {
  const backlog = Math.max(0, input.totalVideos - input.analyzedVideos);
  const portfolio = (input.portfolioReadiness || {}) as JsonRecord;
  const portfolioSummary = (portfolio.summary || portfolio) as JsonRecord;
  const portfolioCoverage = num(portfolioSummary.high_trust_coverage_pct);
  const portfolioExactCoverage = num(portfolioSummary.publishable_exact_coverage_pct);
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
  const briefCoverageFocusSegment = safeSegment(
    records((input.briefCoverageAudit as BriefCoverageAuditSummary | null | undefined)?.gap_queue)[0] || null,
  );
  const shipReadyQueue = (input.shipReadyQueue || {}) as ShipReadyQueueSummary | JsonRecord;
  const shipReadyItems = records((shipReadyQueue as ShipReadyQueueSummary | null | undefined)?.items);
  const shipReadyTopCandidates = records((shipReadyQueue as ShipReadyQueueSummary | null | undefined)?.top_ship_candidates);
  const shipReadyFocusSegment = safeSegment(
    shipReadyTopCandidates[0]
    || shipReadyItems[0]
    || null,
  );
  const briefGapFocus = firstGapFocus(records((input.briefCoverageAudit as BriefCoverageAuditSummary | null | undefined)?.gap_queue)[0] || null);
  const shipGapFocus = firstGapFocus(shipReadyTopCandidates[0] || shipReadyItems[0] || null);
  const shipReadySummary = ((shipReadyQueue as ShipReadyQueueSummary | null | undefined)?.summary || {}) as JsonRecord;
  const publishableExactGapSegment = pickPublishableExactFocusSegment({
    portfolioReadiness: portfolio,
    generationPolicy: input.generationPolicy,
    segmentPriorityQueue: input.segmentPriorityQueue,
  });
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
  const exactProofMissingForDecisionSegment = shouldSupportDecisionSegment
    && !marketBlockedDecisionSupport
    && !readinessBlockedDecisionSupport
    && sameSegment(prioritySegment, exactFocusSegment)
    && Boolean((exactFocusSegment as JsonRecord | null)?.exact_proof_missing);
  const briefBundleGapForDecisionSegment = shouldSupportDecisionSegment
    && !marketBlockedDecisionSupport
    && !readinessBlockedDecisionSupport
    && !exactProofMissingForDecisionSegment
    && sameSegment(prioritySegment, briefCoverageFocusSegment)
    && (
      records((input.briefCoverageAudit as BriefCoverageAuditSummary | null | undefined)?.gap_queue).length > 0
      || num(((input.briefCoverageAudit as BriefCoverageAuditSummary | null | undefined)?.summary || {})["blocked_or_incomplete_segments"]) > 0
    );
  const shipReadyDecisionSegment = shouldSupportDecisionSegment
    && !marketBlockedDecisionSupport
    && !readinessBlockedDecisionSupport
    && !exactProofMissingForDecisionSegment
    && sameSegment(prioritySegment, shipReadyFocusSegment)
    && num(shipReadySummary.ship_candidates) > 0;
  const shouldClosePublishableExactPortfolioGaps = (!shouldSupportDecisionSegment || marketBlockedDecisionSupport || readinessBlockedDecisionSupport)
    && portfolioCoverage >= 60
    && portfolioExactCoverage < 55
    && Boolean(publishableExactGapSegment);
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

  if ((briefBundleGapForDecisionSegment || shipReadyDecisionSegment) && backlog > 0) {
    return {
      task: "analyze_backlog",
      label: shipReadyDecisionSegment
        ? `Дожать ship-ready bundle для ${String(prioritySegment?.label || "")}`
        : `Дожать usable brief для ${String(prioritySegment?.label || "")}`,
      reason: shipReadyDecisionSegment
        ? `${String(prioritySegment?.label || "")} уже попал в ship-ready очередь: trust и exact-proof на месте, но production-grade brief bundle ещё не закрыт.${shipGapFocus.field ? ` Главный пробел сейчас: ${shipGapFocus.field}.` : ""} Следующий цикл лучше потратить на analyze + pattern compaction по этому сегменту, чтобы добить missing fields и перевести его в реально publishable exact brief.`
        : `${String(prioritySegment?.label || "")} уже выглядит достаточно сильным по trust и exact-proof, но usable creative export ещё не собран до конца.${briefGapFocus.field ? ` Главный пробел сейчас: ${briefGapFocus.field}.` : ""} Следующий цикл лучше потратить на analyze + pattern compaction по этому сегменту, чтобы закрыть missing fields и собрать production-usable brief bundle.`,
      endpoint: "/api/factory/jobs/reels-brain-learning",
      params: {
        strategy: "analyze",
        limit: "80",
        build_patterns: "true",
        focus: shipReadyDecisionSegment ? "ship_ready_bundle_completion" : "brief_bundle_completion",
        ...(shipReadyDecisionSegment
          ? {
            field_focus: shipGapFocus.field || "",
            family_focus: shipGapFocus.family || "",
          }
          : {
            field_focus: briefGapFocus.field || "",
            family_focus: briefGapFocus.family || "",
          }),
        ...(prioritySegment ? {
          niche: String(prioritySegment.niche || ""),
          platform: String(prioritySegment.platform || ""),
        } : {}),
      },
      paid_collection: false,
      priority_segment: prioritySegment,
      portfolio_priority_segment: portfolioFocusSegment,
      learning_economics: learningEconomics,
      brief_coverage_focus: briefCoverageFocusSegment,
      ship_ready_focus: shipReadyFocusSegment,
    };
  }

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
    const collectionSegment = shouldClosePublishableExactPortfolioGaps
      ? publishableExactGapSegment
      : shouldClosePortfolioGaps
        ? collectionFocusSegment
        : prioritySegment;
    const policyReason = text(activePolicy?.policy_reason);
    const policyLine = activePolicy
      ? ` Policy ${activePolicyMode}: ${policyReason || `${text(activePolicy.label)} · trust ${text(activePolicy.trust_band)} · evidence ${text(activePolicy.evidence_band)} · readiness ${num(activePolicy.readiness_score)}.`}`
      : "";

    return {
      task: shouldSupportDecisionSegment
        ? marketBlockedDecisionSupport || readinessBlockedDecisionSupport
          ? "collect_portfolio_gaps"
          : "collect_support_for_decision_segment"
        : shouldClosePublishableExactPortfolioGaps || shouldClosePortfolioGaps
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
          : exactProofMissingForDecisionSegment
            ? `Добрать exact proof для ${String(prioritySegment?.label || "")}`
          : shipReadyDecisionSegment
            ? `Дожать ship-ready bundle для ${String(prioritySegment?.label || "")}`
          : briefBundleGapForDecisionSegment
            ? `Дожать usable brief для ${String(prioritySegment?.label || "")}`
          : `Поддержать decision-ready сегмент ${String(prioritySegment?.label || "")}`
        : shouldClosePublishableExactPortfolioGaps
          ? collectionSegment
            ? `Поднимать ${collectionSegment.label} до publishable exact`
            : "Поднимать portfolio до publishable exact"
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
            : exactProofMissingForDecisionSegment
            ? `${String(prioritySegment?.label || activePolicy?.label || "")} уже выглядит strong по briefs/patterns, но exact-segment proof ещё не закрыт. Следующий сбор лучше направить в этот же niche × platform, чтобы добрать доказательный слой, а не масштабировать на transfer-evidence.${policyLine}`
            : shipReadyDecisionSegment
              ? `${String(prioritySegment?.label || activePolicy?.label || "")} уже попал в ship-ready очередь: сегмент силён по exact-proof и policy, но production-grade bundle ещё не закрыт.${shipGapFocus.field ? ` Главный пробел сейчас: ${shipGapFocus.field}.` : ""} Если analyze backlog уже не даёт новых missing fields, следующий цикл может добрать узкий exact material именно под publishable brief completion.${policyLine}`
            : briefBundleGapForDecisionSegment
              ? `${String(prioritySegment?.label || activePolicy?.label || "")} уже strong по evidence, но usable creative brief ещё неполный.${briefGapFocus.field ? ` Главный пробел сейчас: ${briefGapFocus.field}.` : ""} Если backlog уже вычищен, следующий цикл может добрать точечный сегментный материал для закрытия output-gap и сборки production-usable bundle.${policyLine}`
            : `${String(prioritySegment?.label || activePolicy?.label || "")} уже близок к рабочим briefs/hypotheses; следующий сбор лучше направить в этот сегмент.${policyLine}`
        : shouldClosePublishableExactPortfolioGaps
          ? collectionSegment
            ? `High-trust coverage уже ${portfolioCoverage}%, но publishable exact coverage всё ещё ${portfolioExactCoverage}% (${portfolioVerdict}). Следующий сбор направляем в ${collectionSegment.label}, чтобы переводить knowledge-layer в реально publishable exact сегменты.${policyLine}`
            : `High-trust coverage уже ${portfolioCoverage}%, но publishable exact coverage всё ещё ${portfolioExactCoverage}%. Следующий сбор лучше тратить на сегменты, где exact-ready bundle ещё не доведён до publishable состояния.${policyLine}`
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
        ...(exactProofMissingForDecisionSegment
          ? { focus: "exact_segment_proof" }
          : shipReadyDecisionSegment
            ? { focus: "ship_ready_bundle_completion" }
            : briefBundleGapForDecisionSegment
              ? { focus: "brief_bundle_completion" }
              : {}),
        ...exactSourceParams(exactProofMissingForDecisionSegment ? exactFocusSegment : collectionSegment),
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
