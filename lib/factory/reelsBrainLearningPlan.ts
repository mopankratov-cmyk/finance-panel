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

type BriefGapProgressSummary = {
  top_candidates?: Array<JsonRecord>;
  summary?: JsonRecord | null;
};

type GenerationReadinessSummary = {
  summary?: JsonRecord | null;
  upgrade_needed_segments?: Array<JsonRecord>;
  research_segments?: Array<JsonRecord>;
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

function segmentLabel(row: { label?: string; niche?: string; platform?: string } | null | undefined) {
  return text(row?.label, text(row?.niche) && text(row?.platform) ? `${text(row?.niche)} × ${text(row?.platform)}` : "");
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

function gapOutcomeLine(row: JsonRecord | null | undefined) {
  const unlocked = text(row?.unlocked_output);
  const trustBand = text(row?.projected_trust_gain_band);
  const trustScore = num(row?.projected_trust_gain_score);
  const productionState = text(row?.projected_production_state);
  const parts = [
    unlocked ? ` Что откроется после фикса: ${unlocked}.` : "",
    trustScore > 0 ? ` Ожидаемый trust delta: +${trustScore}${trustBand ? ` (${trustBand})` : ""}.` : "",
    productionState ? ` Следующее состояние: ${productionState}.` : "",
  ].filter(Boolean);
  return parts.join("");
}

function upgradeParams(row: JsonRecord | null | undefined) {
  const trustScore = num(row?.projected_trust_gain_score);
  const trustBand = text(row?.projected_trust_gain_band);
  const unlockedOutput = text(row?.unlocked_output);
  const productionState = text(row?.projected_production_state);
  const recommendedLoop = text(row?.recommended_loop);
  return {
    ...(trustScore > 0 ? { projected_trust_gain_score: String(trustScore) } : {}),
    ...(trustBand ? { projected_trust_gain_band: trustBand } : {}),
    ...(unlockedOutput ? { unlocked_output: unlockedOutput } : {}),
    ...(productionState ? { projected_production_state: productionState } : {}),
    ...(recommendedLoop ? { recommended_loop: recommendedLoop } : {}),
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

function selectUpgradePrioritySegment(input: {
  prioritySegment: FocusSegment | null;
  briefGapCandidates: JsonRecord[];
  shipReadyTopCandidates: JsonRecord[];
  shipReadyItems: JsonRecord[];
  generationUpgradeCandidates?: JsonRecord[];
  generationPolicy?: JsonRecord | null;
}) {
  const uniqueCandidates = new Map<string, FocusSegment>();
  for (const source of [...(input.generationUpgradeCandidates || []), ...input.briefGapCandidates, ...input.shipReadyTopCandidates, ...input.shipReadyItems]) {
    const candidate = safeSegment(source);
    if (!candidate) continue;
    uniqueCandidates.set(`${candidate.niche}__${candidate.platform}`, candidate);
  }
  const ranked = Array.from(uniqueCandidates.values())
    .map((row) => {
      const policy = selectPolicyForSegment(input.generationPolicy, row);
      const trustGain = num((row as JsonRecord).projected_trust_gain_score);
      const lane = text((row as JsonRecord).lane);
      const score = trustGain
        + (lane === "ship" ? 10 : lane === "validate" ? 5 : 0)
        + (text((row as JsonRecord).proof_quality) === "exact_segment" ? 8 : 0)
        + (text(policy?.policy_mode) === "primary" ? 6 : text(policy?.policy_mode) === "control_only" ? 3 : 0);
      return { row, policy, trustGain, score };
    })
    .sort((a, b) => b.score - a.score || b.trustGain - a.trustGain || a.row.label.localeCompare(b.row.label));
  const best = ranked[0] || null;
  if (!best) return input.prioritySegment;
  if (!input.prioritySegment || sameSegment(input.prioritySegment, best.row)) return input.prioritySegment || best.row;

  const currentPolicy = selectPolicyForSegment(input.generationPolicy, input.prioritySegment);
  const currentTrustGain = input.briefGapCandidates
    .filter((row) => sameSegment(input.prioritySegment, row as { niche?: string; platform?: string }))
    .map((row) => num(row.projected_trust_gain_score))
    .sort((a, b) => b - a)[0] || 0;
  const currentScore = currentTrustGain
    + (input.prioritySegment.action === "promote_segment_briefs" ? 10 : input.prioritySegment.action === "validate_segment_briefs" ? 5 : 0)
    + (text(currentPolicy?.policy_mode) === "primary" ? 6 : text(currentPolicy?.policy_mode) === "control_only" ? 3 : 0);

  if (best.trustGain >= 24 && (best.score >= currentScore + 8 || currentTrustGain === 0) && text(best.policy?.policy_mode) !== "research_only") {
    return {
      ...best.row,
      action: text(best.row.action, text(best.policy?.policy_mode) === "primary" ? "promote_segment_briefs" : "validate_segment_briefs"),
      ready_for_generation: true,
    } as FocusSegment;
  }

  return input.prioritySegment;
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
  briefGapProgress?: BriefGapProgressSummary | JsonRecord | null;
  generationReadiness?: GenerationReadinessSummary | JsonRecord | null;
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
  const briefGapProgress = (input.briefGapProgress || {}) as BriefGapProgressSummary | JsonRecord;
  const briefGapCandidates = records((briefGapProgress as BriefGapProgressSummary | null | undefined)?.top_candidates);
  const briefGapProgressFocusSegment = safeSegment(briefGapCandidates[0] || null);
  const shipReadyFocusSegment = safeSegment(
    shipReadyTopCandidates[0]
    || shipReadyItems[0]
    || null,
  );
  const briefGapFocus = firstGapFocus(briefGapCandidates[0] || records((input.briefCoverageAudit as BriefCoverageAuditSummary | null | undefined)?.gap_queue)[0] || null);
  const briefGapOutcome = gapOutcomeLine(briefGapCandidates[0] || null);
  const shipGapFocus = firstGapFocus(
    briefGapProgressFocusSegment && text((briefGapProgressFocusSegment as JsonRecord).lane) === "ship"
      ? briefGapProgressFocusSegment
      : shipReadyTopCandidates[0] || shipReadyItems[0] || null,
  );
  const shipGapOutcome = gapOutcomeLine(
    briefGapProgressFocusSegment && text((briefGapProgressFocusSegment as JsonRecord).lane) === "ship"
      ? briefGapProgressFocusSegment
      : null,
  );
  const shipReadySummary = ((shipReadyQueue as ShipReadyQueueSummary | null | undefined)?.summary || {}) as JsonRecord;
  const generationReadiness = (input.generationReadiness || {}) as GenerationReadinessSummary | JsonRecord;
  const generationSummary = (((generationReadiness as GenerationReadinessSummary).summary) || {}) as JsonRecord;
  const generationUpgradeCandidates = records((generationReadiness as GenerationReadinessSummary).upgrade_needed_segments);
  const generationUpgradeFocusSegment = safeSegment(generationUpgradeCandidates[0] || null);
  const publishableExactGapSegment = pickPublishableExactFocusSegment({
    portfolioReadiness: portfolio,
    generationPolicy: input.generationPolicy,
    segmentPriorityQueue: input.segmentPriorityQueue,
  });
  const upgradePrioritySegment = selectUpgradePrioritySegment({
    prioritySegment,
    briefGapCandidates,
    shipReadyTopCandidates,
    shipReadyItems,
    generationUpgradeCandidates,
    generationPolicy: input.generationPolicy,
  });
  const executionPrioritySegment = upgradePrioritySegment || prioritySegment;
  const collectionFocusSegment = exactFocusSegment || portfolioFocusSegment || executionPrioritySegment;
  const directSegmentPolicy = selectPolicyForSegment(input.generationPolicy, executionPrioritySegment);
  const directPolicyMode = text(directSegmentPolicy?.policy_mode, "research_only");
  const directOutcomeStatus = text((directSegmentPolicy as JsonRecord | null)?.outcome_status, "no_feedback");
  const shouldSupportDecisionSegment = executionPrioritySegment?.action === "promote_segment_briefs"
    || executionPrioritySegment?.action === "validate_segment_briefs"
    || directPolicyMode === "primary"
    || directPolicyMode === "control_only";
  const readinessBlockedDecisionSupport = Boolean(executionPrioritySegment?.readiness_blocked);
  const marketBlockedDecisionSupport = directOutcomeStatus === "weak";
  const exactProofMissingForDecisionSegment = shouldSupportDecisionSegment
    && !marketBlockedDecisionSupport
    && !readinessBlockedDecisionSupport
    && sameSegment(executionPrioritySegment, exactFocusSegment)
    && Boolean((exactFocusSegment as JsonRecord | null)?.exact_proof_missing);
  const briefBundleGapForDecisionSegment = shouldSupportDecisionSegment
    && !marketBlockedDecisionSupport
    && !readinessBlockedDecisionSupport
    && !exactProofMissingForDecisionSegment
    && sameSegment(executionPrioritySegment, briefGapProgressFocusSegment || briefCoverageFocusSegment)
    && (
      briefGapCandidates.length > 0
      || records((input.briefCoverageAudit as BriefCoverageAuditSummary | null | undefined)?.gap_queue).length > 0
      || num(((input.briefGapProgress as BriefGapProgressSummary | null | undefined)?.summary || {})["total"]) > 0
      || num(((input.briefCoverageAudit as BriefCoverageAuditSummary | null | undefined)?.summary || {})["blocked_or_incomplete_segments"]) > 0
    );
  const shipReadyDecisionSegment = shouldSupportDecisionSegment
    && !marketBlockedDecisionSupport
    && !readinessBlockedDecisionSupport
    && !exactProofMissingForDecisionSegment
    && sameSegment(executionPrioritySegment, briefGapProgressFocusSegment && text((briefGapProgressFocusSegment as JsonRecord).lane) === "ship"
      ? briefGapProgressFocusSegment
      : shipReadyFocusSegment)
    && num(shipReadySummary.ship_candidates) > 0;
  const shouldClosePublishableExactPortfolioGaps = (!shouldSupportDecisionSegment || marketBlockedDecisionSupport || readinessBlockedDecisionSupport)
    && portfolioCoverage >= 60
    && portfolioExactCoverage < 55
    && Boolean(publishableExactGapSegment);
  const activePolicySegment = shouldSupportDecisionSegment ? executionPrioritySegment : collectionFocusSegment || executionPrioritySegment;
  const activePolicy = selectPolicyForSegment(input.generationPolicy, activePolicySegment);
  const activePolicyMode = text(activePolicy?.policy_mode, "research_only");
  const patternGainTrend = learningEconomics.pattern_gain_cost_trend;
  const expensivePatternGain = patternGainTrend === "more_expensive" || learningEconomics.weak_pattern_gain;
  const generationReadyPct = num(generationSummary.segment_specific_ready_pct);
  const generationNicheReadyPct = num(generationSummary.niche_specific_ready_pct);
  const generationPlatformReadyPct = num(generationSummary.platform_specific_ready_pct);
  const lowGenerationReadiness = portfolioCoverage >= 60
    && (generationReadyPct < 35 || generationNicheReadyPct < 50 || generationPlatformReadyPct < 50)
    && Boolean(generationUpgradeFocusSegment);
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
        ? `Дожать ship-ready bundle для ${segmentLabel(executionPrioritySegment)}`
        : `Дожать usable brief для ${segmentLabel(executionPrioritySegment)}`,
      reason: shipReadyDecisionSegment
        ? `${segmentLabel(executionPrioritySegment)} уже попал в ship-ready очередь: trust и exact-proof на месте, но production-grade brief bundle ещё не закрыт.${shipGapFocus.field ? ` Главный пробел сейчас: ${shipGapFocus.field}.` : ""}${shipGapOutcome} Следующий цикл лучше потратить на analyze + pattern compaction по этому сегменту, чтобы добить missing fields и перевести его в реально publishable exact brief.`
        : `${segmentLabel(executionPrioritySegment)} уже выглядит достаточно сильным по trust и exact-proof, но usable creative export ещё не собран до конца.${briefGapFocus.field ? ` Главный пробел сейчас: ${briefGapFocus.field}.` : ""}${briefGapOutcome} Следующий цикл лучше потратить на analyze + pattern compaction по этому сегменту, чтобы закрыть missing fields и собрать production-usable bundle.`,
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
        ...upgradeParams(
          shipReadyDecisionSegment
            ? (briefGapProgressFocusSegment && text((briefGapProgressFocusSegment as JsonRecord).lane) === "ship"
                ? briefGapProgressFocusSegment
                : shipReadyTopCandidates[0] || shipReadyItems[0] || null)
            : briefGapCandidates[0] || null,
        ),
        ...(executionPrioritySegment ? {
          niche: String(executionPrioritySegment.niche || ""),
          platform: String(executionPrioritySegment.platform || ""),
        } : {}),
      },
      paid_collection: false,
      priority_segment: executionPrioritySegment,
      portfolio_priority_segment: portfolioFocusSegment,
      learning_economics: learningEconomics,
      brief_coverage_focus: briefCoverageFocusSegment,
      brief_gap_progress_focus: briefGapProgressFocusSegment,
      ship_ready_focus: shipReadyFocusSegment,
    };
  }

  if (lowGenerationReadiness && backlog > 0) {
    return {
      task: "analyze_backlog",
      label: `Довести ${segmentLabel(generationUpgradeFocusSegment)} до high-trust output`,
      reason: `${segmentLabel(generationUpgradeFocusSegment)} уже близок к publishable exact, но generation-ready coverage пока только ${generationReadyPct}% по сегментам, ${generationNicheReadyPct}% по нишам и ${generationPlatformReadyPct}% по платформам. Следующий цикл лучше потратить на analyze + pattern compaction по этому сегменту, чтобы перевести знание в реально usable brief/hypothesis/content solution, а не просто добирать общий корпус.`,
      endpoint: "/api/factory/jobs/reels-brain-learning",
      params: {
        strategy: "analyze",
        limit: "80",
        build_patterns: "true",
        focus: "high_trust_generation_upgrade",
        ...(generationUpgradeFocusSegment ? {
          niche: String(generationUpgradeFocusSegment.niche || ""),
          platform: String(generationUpgradeFocusSegment.platform || ""),
        } : {}),
      },
      paid_collection: false,
      priority_segment: generationUpgradeFocusSegment,
      portfolio_priority_segment: portfolioFocusSegment,
      learning_economics: learningEconomics,
      generation_readiness_focus: generationUpgradeFocusSegment,
    };
  }

  if (shouldAnalyzeForEconomics) {
    return {
      task: "analyze_backlog",
      label: "Сначала разобрать накопленный backlog",
      reason: expensivePatternGain
        ? `В базе есть ${backlog} неразобранных видео, а economics уже ухудшилась (${patternGainTrend || "weak_pattern_gain"}). Сейчас выгоднее дожать анализ и pattern compaction, чем покупать новый сбор.${executionPrioritySegment ? ` Главный сегмент тика: ${segmentLabel(executionPrioritySegment)}.` : ""}`
        : `В базе есть ${backlog} неразобранных видео. Дешевле превратить их в память, чем покупать новый сбор.${executionPrioritySegment ? ` Главный сегмент тика: ${segmentLabel(executionPrioritySegment)}.` : ""}`,
      endpoint: "/api/factory/jobs/reels-brain-learning",
      params: {
        strategy: "analyze",
        limit: expensivePatternGain ? "100" : "80",
        ...(expensivePatternGain ? { build_patterns: "true" } : {}),
        ...(executionPrioritySegment ? {
          niche: String(executionPrioritySegment.niche || ""),
          platform: String(executionPrioritySegment.platform || ""),
        } : {}),
      },
      paid_collection: false,
      priority_segment: executionPrioritySegment,
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
      priority_segment: executionPrioritySegment,
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
      priority_segment: executionPrioritySegment,
      portfolio_priority_segment: portfolioFocusSegment,
      learning_economics: learningEconomics,
    };
  }

  if (input.totalVideos < input.target) {
    const shouldClosePortfolioGaps = (!shouldSupportDecisionSegment || marketBlockedDecisionSupport || readinessBlockedDecisionSupport) && portfolioCoverage < 70;
    const collectionSegment = shouldClosePublishableExactPortfolioGaps
      ? publishableExactGapSegment
      : lowGenerationReadiness
        ? generationUpgradeFocusSegment
      : shouldClosePortfolioGaps
        ? collectionFocusSegment
        : executionPrioritySegment;
    const policyReason = text(activePolicy?.policy_reason);
    const policyLine = activePolicy
      ? ` Policy ${activePolicyMode}: ${policyReason || `${text(activePolicy.label)} · trust ${text(activePolicy.trust_band)} · evidence ${text(activePolicy.evidence_band)} · readiness ${num(activePolicy.readiness_score)}.`}`
      : "";

    return {
      task: shouldSupportDecisionSegment
        ? marketBlockedDecisionSupport || readinessBlockedDecisionSupport
          ? "collect_portfolio_gaps"
          : "collect_support_for_decision_segment"
        : shouldClosePublishableExactPortfolioGaps || lowGenerationReadiness || shouldClosePortfolioGaps
          ? "collect_portfolio_gaps"
          : "collect_smart_batch",
      label: shouldSupportDecisionSegment
        ? marketBlockedDecisionSupport || readinessBlockedDecisionSupport
          ? collectionSegment
            ? readinessBlockedDecisionSupport
              ? `Сегмент ${segmentLabel(executionPrioritySegment)} ещё сырой; закрывать дыру ${collectionSegment.label}`
              : `Не усиливать weak сегмент; закрывать дыру ${collectionSegment.label}`
            : readinessBlockedDecisionSupport
              ? "Сегмент ещё сырой; закрывать portfolio gaps"
              : "Не усиливать weak сегмент; закрывать portfolio gaps"
          : exactProofMissingForDecisionSegment
            ? `Добрать exact proof для ${segmentLabel(executionPrioritySegment)}`
          : shipReadyDecisionSegment
            ? `Дожать ship-ready bundle для ${segmentLabel(executionPrioritySegment)}`
          : briefBundleGapForDecisionSegment
            ? `Дожать usable brief для ${segmentLabel(executionPrioritySegment)}`
          : `Поддержать decision-ready сегмент ${segmentLabel(executionPrioritySegment)}`
        : shouldClosePublishableExactPortfolioGaps
          ? collectionSegment
            ? `Поднимать ${collectionSegment.label} до publishable exact`
            : "Поднимать portfolio до publishable exact"
        : lowGenerationReadiness
          ? collectionSegment
            ? `Доводить ${collectionSegment.label} до high-trust output`
            : "Доводить strongest segments до high-trust output"
        : shouldClosePortfolioGaps
          ? collectionSegment
            ? `Закрывать дыру ${collectionSegment.label} в portfolio coverage`
            : "Закрывать дыры в portfolio coverage"
          : "Добрать новую умную пачку",
      reason: shouldSupportDecisionSegment
        ? marketBlockedDecisionSupport
          ? `${segmentLabel(executionPrioritySegment || activePolicy)} формально близок к decision-ready, но рынок уже даёт weak outcome; следующий сбор лучше не вливать в него, а закрывать другие gaps.${policyLine}`
          : readinessBlockedDecisionSupport
            ? `${segmentLabel(executionPrioritySegment || activePolicy)} силён по trust, но ещё не дозрел по learning-layer (${String(executionPrioritySegment?.readiness_dominant_gap || "readiness")} backlog ${num(executionPrioritySegment?.readiness_total_backlog)}). Сначала закрываем readiness gap и только потом усиливаем segment briefs.${policyLine}`
            : exactProofMissingForDecisionSegment
            ? `${segmentLabel(executionPrioritySegment || activePolicy)} уже выглядит strong по briefs/patterns, но exact-segment proof ещё не закрыт. Следующий сбор лучше направить в этот же niche × platform, чтобы добрать доказательный слой, а не масштабировать на transfer-evidence.${policyLine}`
            : shipReadyDecisionSegment
              ? `${segmentLabel(executionPrioritySegment || activePolicy)} уже попал в ship-ready очередь: сегмент силён по exact-proof и policy, но production-grade bundle ещё не закрыт.${shipGapFocus.field ? ` Главный пробел сейчас: ${shipGapFocus.field}.` : ""}${shipGapOutcome} Если analyze backlog уже не даёт новых missing fields, следующий цикл может добрать узкий exact material именно под publishable brief completion.${policyLine}`
            : briefBundleGapForDecisionSegment
              ? `${segmentLabel(executionPrioritySegment || activePolicy)} уже strong по evidence, но usable creative brief ещё неполный.${briefGapFocus.field ? ` Главный пробел сейчас: ${briefGapFocus.field}.` : ""}${briefGapOutcome} Если backlog уже вычищен, следующий цикл может добрать точечный сегментный материал для закрытия output-gap и сборки production-usable bundle.${policyLine}`
            : `${segmentLabel(executionPrioritySegment || activePolicy)} уже близок к рабочим briefs/hypotheses; следующий сбор лучше направить в этот сегмент.${policyLine}`
        : shouldClosePublishableExactPortfolioGaps
          ? collectionSegment
            ? `High-trust coverage уже ${portfolioCoverage}%, но publishable exact coverage всё ещё ${portfolioExactCoverage}% (${portfolioVerdict}). Следующий сбор направляем в ${collectionSegment.label}, чтобы переводить knowledge-layer в реально publishable exact сегменты.${policyLine}`
            : `High-trust coverage уже ${portfolioCoverage}%, но publishable exact coverage всё ещё ${portfolioExactCoverage}%. Следующий сбор лучше тратить на сегменты, где exact-ready bundle ещё не доведён до publishable состояния.${policyLine}`
        : lowGenerationReadiness
          ? collectionSegment
            ? `Портфель уже набирает trust coverage, но generation-ready coverage всё ещё низкая: ${generationReadyPct}% сегментов, ${generationNicheReadyPct}% ниш и ${generationPlatformReadyPct}% платформ реально дают high-trust output. Следующий сбор направляем в ${collectionSegment.label}, чтобы довести publishable exact знание до usable brief/hypothesis/content solution.${policyLine}`
            : `Портфель уже набирает trust coverage, но generation-ready coverage всё ещё низкая. Следующий сбор лучше тратить на сегменты, где publishable exact ещё не доведён до real high-trust output.${policyLine}`
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
      priority_segment: executionPrioritySegment,
      portfolio_priority_segment: portfolioFocusSegment,
      portfolio_readiness: portfolio,
      generation_policy: activePolicy,
      generation_readiness: generationReadiness,
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
    priority_segment: executionPrioritySegment,
    portfolio_priority_segment: portfolioFocusSegment,
    portfolio_readiness: portfolio,
    learning_economics: learningEconomics,
  };
}

export { clamp, num, text };
