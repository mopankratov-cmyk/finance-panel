type JsonRecord = Record<string, unknown>;

function rec(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type BulkProfile = {
  max_lanes: number;
  limit: number;
  providers_per_lane: number;
  query_variants_per_lane: number;
  provider_timeout_ms: number;
  max_provider_calls: number;
  max_cost_units: number;
};

type AnalyzeProfile = {
  max_lanes: number;
  limit: number;
  build_patterns: boolean;
};

export type ReelsBrainCronExecutionIntent = {
  mode:
    | "generic_bulk"
    | "close_portfolio_gap"
    | "close_exact_segment_gap"
    | "support_primary_segment"
    | "support_control_segment"
    | "explore_research_segment"
    | "generic_analyze"
    | "ship_ready_bundle_completion"
    | "high_trust_generation_upgrade"
    | "pattern_compaction";
  task: "bulk" | "analyze";
  focus_segment: string | null;
  policy_mode: "primary" | "control_only" | "research_only";
  explanation: string;
  preferred_provider?: string | null;
  source_discovery_mode?: string | null;
  source_provider_reason?: string | null;
  field_focus?: string | null;
  family_focus?: string | null;
  recommended_loop?: string | null;
  unlocked_output?: string | null;
  projected_production_state?: string | null;
  projected_trust_gain_score?: number;
  projected_trust_gain_band?: string | null;
  bulk_overrides?: Partial<BulkProfile> & { hours?: number };
  analyze_overrides?: Partial<AnalyzeProfile>;
};

type LearningEconomics = {
  pattern_gain_cost_trend: string;
  weak_pattern_gain: boolean;
  pattern_gain_proxy_total: number;
  high_trust_gain_proxy_total: number;
};

function safeLearningEconomics(value: unknown): LearningEconomics {
  const row = rec(value);
  return {
    pattern_gain_cost_trend: text(row.pattern_gain_cost_trend, "not_enough_data"),
    weak_pattern_gain: Boolean(row.weak_pattern_gain),
    pattern_gain_proxy_total: num(row.pattern_gain_proxy_total),
    high_trust_gain_proxy_total: num(row.high_trust_gain_proxy_total),
  };
}

export function buildReelsBrainCronExecutionIntent(input: {
  task: "bulk" | "analyze";
  nextTick?: JsonRecord | null;
}) : ReelsBrainCronExecutionIntent {
  const nextTick = rec(input.nextTick);
  const taskName = text(nextTick.task);
  const prioritySegment = rec(nextTick.priority_segment);
  const portfolioSegment = rec(nextTick.portfolio_priority_segment);
  const policy = rec(nextTick.generation_policy);
  const policyModeRaw = text(policy.policy_mode, "research_only");
  const policyMode = (policyModeRaw === "primary" || policyModeRaw === "control_only")
    ? policyModeRaw
    : "research_only";
  const params = rec(nextTick.params);
  const exactProofFocus = text(params.focus) === "exact_segment_proof";
  const shipReadyFocus = text(params.focus) === "ship_ready_bundle_completion";
  const generationUpgradeFocus = text(params.focus) === "high_trust_generation_upgrade";
  const preferredProvider = text(params.preferred_provider) || null;
  const sourceDiscoveryMode = text(params.source_discovery_mode) || null;
  const sourceProviderReason = text(params.source_provider_reason) || null;
  const fieldFocus = text(params.field_focus) || null;
  const familyFocus = text(params.family_focus) || null;
  const recommendedLoop = text(params.recommended_loop) || null;
  const unlockedOutput = text(params.unlocked_output) || null;
  const projectedProductionState = text(params.projected_production_state) || null;
  const projectedTrustGainScore = num(params.projected_trust_gain_score);
  const projectedTrustGainBand = text(params.projected_trust_gain_band) || null;
  const learningEconomics = safeLearningEconomics(nextTick.learning_economics);
  const expensivePatternGain = learningEconomics.weak_pattern_gain
    || learningEconomics.pattern_gain_cost_trend === "more_expensive";
  const projectedGainLine = projectedTrustGainScore > 0
    ? ` Апгрейд даёт около +${projectedTrustGainScore}${projectedTrustGainBand ? ` trust (${projectedTrustGainBand})` : " trust"}.`
    : "";
  const priorityLabel = text(prioritySegment.label);
  const portfolioLabel = text(portfolioSegment.label);
  const focusSegment = priorityLabel || portfolioLabel || text(policy.label) || null;

  if (input.task === "analyze") {
    if (taskName === "build_patterns") {
      return {
        mode: "pattern_compaction",
        task: "analyze",
        focus_segment: focusSegment,
        policy_mode: policyMode,
        explanation: focusSegment
          ? `Pattern compaction for ${focusSegment}: корпус уже собран, надо сжать память в стабильные паттерны.`
          : "Pattern compaction: корпус уже собран, надо сжать память в стабильные паттерны.",
        analyze_overrides: {
          max_lanes: 2,
          limit: 10,
          build_patterns: true,
        },
        preferred_provider: preferredProvider,
        source_discovery_mode: sourceDiscoveryMode,
        source_provider_reason: sourceProviderReason,
        field_focus: fieldFocus,
        family_focus: familyFocus,
        recommended_loop: recommendedLoop,
        unlocked_output: unlockedOutput,
        projected_production_state: projectedProductionState,
        projected_trust_gain_score: projectedTrustGainScore,
        projected_trust_gain_band: projectedTrustGainBand,
      };
    }

    if (shipReadyFocus) {
      return {
        mode: "ship_ready_bundle_completion",
        task: "analyze",
        focus_segment: focusSegment,
        policy_mode: policyMode,
        explanation: focusSegment
          ? `Ship-ready bundle completion for ${focusSegment}: дожимаем publishable exact brief, а не просто общий backlog analyze.${projectedGainLine}`
          : `Ship-ready bundle completion: дожимаем publishable exact brief.${projectedGainLine}`,
        analyze_overrides: {
          max_lanes: 1,
          limit: 10,
          build_patterns: true,
        },
        preferred_provider: preferredProvider,
        source_discovery_mode: sourceDiscoveryMode,
        source_provider_reason: sourceProviderReason,
        field_focus: fieldFocus,
        family_focus: familyFocus,
        recommended_loop: recommendedLoop,
        unlocked_output: unlockedOutput,
        projected_production_state: projectedProductionState,
        projected_trust_gain_score: projectedTrustGainScore,
        projected_trust_gain_band: projectedTrustGainBand,
      };
    }

    if (generationUpgradeFocus) {
      return {
        mode: "high_trust_generation_upgrade",
        task: "analyze",
        focus_segment: focusSegment,
        policy_mode: policyMode,
        explanation: focusSegment
          ? `High-trust generation upgrade for ${focusSegment}: дожимаем publishable exact сегмент до usable brief/hypothesis/content solution, а не просто анализируем общий backlog.${projectedGainLine}`
          : `High-trust generation upgrade: дожимаем publishable exact сегмент до usable output.${projectedGainLine}`,
        analyze_overrides: {
          max_lanes: 1,
          limit: 12,
          build_patterns: true,
        },
        preferred_provider: preferredProvider,
        source_discovery_mode: sourceDiscoveryMode,
        source_provider_reason: sourceProviderReason,
        field_focus: fieldFocus,
        family_focus: familyFocus,
        recommended_loop: recommendedLoop,
        unlocked_output: unlockedOutput,
        projected_production_state: projectedProductionState,
        projected_trust_gain_score: projectedTrustGainScore,
        projected_trust_gain_band: projectedTrustGainBand,
      };
    }

    return {
      mode: "generic_analyze",
      task: "analyze",
      focus_segment: focusSegment,
      policy_mode: policyMode,
      explanation: focusSegment
        ? `Analyze backlog around ${focusSegment}: сначала превратить накопленный корпус в память.`
        : "Analyze backlog: сначала превратить накопленный корпус в память.",
      analyze_overrides: {
        ...(policyMode === "primary" || policyMode === "control_only"
          ? {
            build_patterns: true,
            max_lanes: 2,
            limit: 12,
          }
          : {}),
        ...(expensivePatternGain
          ? {
            build_patterns: true,
            max_lanes: 3,
            limit: 16,
          }
          : {}),
      },
      preferred_provider: preferredProvider,
      source_discovery_mode: sourceDiscoveryMode,
      source_provider_reason: sourceProviderReason,
      field_focus: fieldFocus,
      family_focus: familyFocus,
      recommended_loop: recommendedLoop,
      unlocked_output: unlockedOutput,
      projected_production_state: projectedProductionState,
      projected_trust_gain_score: projectedTrustGainScore,
      projected_trust_gain_band: projectedTrustGainBand,
    };
  }

  if (taskName === "collect_portfolio_gaps") {
    return {
      mode: exactProofFocus ? "close_exact_segment_gap" : "close_portfolio_gap",
      task: "bulk",
      focus_segment: portfolioLabel || focusSegment,
      policy_mode: policyMode,
      explanation: exactProofFocus
        ? portfolioLabel
          ? `Close exact-proof gap for ${portfolioLabel}: добираем точное niche/platform доказательство, а не общий portfolio coverage.`
          : "Close exact-proof gap: добираем точное niche/platform доказательство."
        : portfolioLabel
          ? `Close portfolio gap for ${portfolioLabel}: добираем именно недостающий niche/platform сегмент.`
          : "Close portfolio gap: добираем недостающий niche/platform сегмент.",
      bulk_overrides: {
        max_lanes: 1,
        limit: exactProofFocus ? 18 : 24,
        providers_per_lane: 1,
        query_variants_per_lane: 1,
        provider_timeout_ms: exactProofFocus ? 14000 : undefined,
        max_provider_calls: exactProofFocus ? 2 : 3,
        max_cost_units: exactProofFocus ? 6 : 8,
        hours: exactProofFocus ? 48 : 96,
      },
      preferred_provider: preferredProvider,
      source_discovery_mode: sourceDiscoveryMode,
      source_provider_reason: sourceProviderReason,
      field_focus: fieldFocus,
      family_focus: familyFocus,
      recommended_loop: recommendedLoop,
      unlocked_output: unlockedOutput,
      projected_production_state: projectedProductionState,
      projected_trust_gain_score: projectedTrustGainScore,
      projected_trust_gain_band: projectedTrustGainBand,
    };
  }

  if (taskName === "collect_support_for_decision_segment") {
    if (exactProofFocus) {
      return {
        mode: "close_exact_segment_gap",
        task: "bulk",
        focus_segment: focusSegment,
        policy_mode: policyMode,
        explanation: focusSegment
          ? `Close exact-proof gap for ${focusSegment}: сегмент уже силён по transfer/pattern layer, теперь добираем именно exact niche × platform proof.`
          : "Close exact-proof gap: добираем именно exact niche × platform proof.",
        bulk_overrides: {
          max_lanes: 1,
          limit: 18,
          providers_per_lane: 1,
          query_variants_per_lane: 1,
          provider_timeout_ms: 14000,
          max_provider_calls: 2,
          max_cost_units: 6,
          hours: 48,
        },
        preferred_provider: preferredProvider,
        source_discovery_mode: sourceDiscoveryMode,
        source_provider_reason: sourceProviderReason,
        field_focus: fieldFocus,
        family_focus: familyFocus,
        recommended_loop: recommendedLoop,
        unlocked_output: unlockedOutput,
        projected_production_state: projectedProductionState,
        projected_trust_gain_score: projectedTrustGainScore,
        projected_trust_gain_band: projectedTrustGainBand,
      };
    }

    if (policyMode === "primary") {
      return {
        mode: "support_primary_segment",
        task: "bulk",
        focus_segment: focusSegment,
        policy_mode: policyMode,
        explanation: focusSegment
          ? `Support primary segment ${focusSegment}: добираем свежие подтверждения для почти production-ready механики.`
          : "Support primary segment: добираем свежие подтверждения для почти production-ready механики.",
        bulk_overrides: {
          max_lanes: 1,
          limit: 18,
          providers_per_lane: 1,
          query_variants_per_lane: 1,
          provider_timeout_ms: 14000,
          max_provider_calls: 2,
          max_cost_units: 6,
          hours: 48,
        },
        preferred_provider: preferredProvider,
        source_discovery_mode: sourceDiscoveryMode,
        source_provider_reason: sourceProviderReason,
        field_focus: fieldFocus,
        family_focus: familyFocus,
        recommended_loop: recommendedLoop,
        unlocked_output: unlockedOutput,
        projected_production_state: projectedProductionState,
        projected_trust_gain_score: projectedTrustGainScore,
        projected_trust_gain_band: projectedTrustGainBand,
      };
    }

    if (policyMode === "control_only") {
      return {
        mode: "support_control_segment",
        task: "bulk",
        focus_segment: focusSegment,
        policy_mode: policyMode,
        explanation: focusSegment
          ? `Support control segment ${focusSegment}: добираем корпус для controlled validation, не для широкого explore.`
          : "Support control segment: добираем корпус для controlled validation, не для широкого explore.",
        bulk_overrides: {
          max_lanes: 1,
          limit: 22,
          providers_per_lane: 1,
          query_variants_per_lane: 2,
          max_provider_calls: 3,
          max_cost_units: 8,
          hours: 72,
        },
        preferred_provider: preferredProvider,
        source_discovery_mode: sourceDiscoveryMode,
        source_provider_reason: sourceProviderReason,
        field_focus: fieldFocus,
        family_focus: familyFocus,
        recommended_loop: recommendedLoop,
        unlocked_output: unlockedOutput,
        projected_production_state: projectedProductionState,
        projected_trust_gain_score: projectedTrustGainScore,
        projected_trust_gain_band: projectedTrustGainBand,
      };
    }
  }

  if (policyMode === "research_only") {
    return {
      mode: "explore_research_segment",
      task: "bulk",
      focus_segment: focusSegment,
      policy_mode: policyMode,
      explanation: focusSegment
        ? expensivePatternGain
          ? `Explore research segment ${focusSegment}: доверие ещё не собрано, но pattern gain деградирует, поэтому discovery сужаем и делаем его дешевле.`
          : `Explore research segment ${focusSegment}: держим discovery шире, потому что доверие ещё не собрано.`
        : expensivePatternGain
          ? "Explore research segment: pattern gain дорожает, поэтому discovery сужаем и делаем его дешевле."
          : "Explore research segment: держим discovery шире, потому что доверие ещё не собрано.",
      bulk_overrides: {
        providers_per_lane: expensivePatternGain ? 1 : 2,
        query_variants_per_lane: expensivePatternGain ? 1 : 2,
        max_lanes: expensivePatternGain ? 1 : undefined,
        limit: expensivePatternGain ? 18 : undefined,
        max_provider_calls: expensivePatternGain ? 2 : undefined,
        max_cost_units: expensivePatternGain ? 6 : undefined,
        hours: expensivePatternGain ? 48 : 96,
      },
      preferred_provider: preferredProvider,
      source_discovery_mode: sourceDiscoveryMode,
      source_provider_reason: sourceProviderReason,
      field_focus: fieldFocus,
      family_focus: familyFocus,
      recommended_loop: recommendedLoop,
      unlocked_output: unlockedOutput,
      projected_production_state: projectedProductionState,
      projected_trust_gain_score: projectedTrustGainScore,
      projected_trust_gain_band: projectedTrustGainBand,
    };
  }

  return {
    mode: "generic_bulk",
    task: "bulk",
    focus_segment: focusSegment,
    policy_mode: policyMode,
    explanation: focusSegment
      ? `Generic bulk around ${focusSegment}: corpus growth without narrow execution overrides.`
      : "Generic bulk: corpus growth without narrow execution overrides.",
      preferred_provider: preferredProvider,
      source_discovery_mode: sourceDiscoveryMode,
      source_provider_reason: sourceProviderReason,
      field_focus: fieldFocus,
      family_focus: familyFocus,
      recommended_loop: recommendedLoop,
      unlocked_output: unlockedOutput,
      projected_production_state: projectedProductionState,
      projected_trust_gain_score: projectedTrustGainScore,
      projected_trust_gain_band: projectedTrustGainBand,
    };
}
