type JsonRecord = Record<string, unknown>;

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

function modeFromProductionState(value: unknown) {
  const state = text(value, "research_only");
  if (state === "ready_now") return "primary";
  if (state === "controlled_test") return "control_only";
  return "research_only";
}

function outcomeAdjustedPolicyMode(baseMode: string, outcomeStatus: string) {
  if (outcomeStatus === "weak") return "research_only";
  if (outcomeStatus === "promising" && baseMode === "primary") return "control_only";
  return baseMode;
}

function defaultPolicyReason(primary: JsonRecord | null, nextGap: JsonRecord | null, scope: "niche" | "platform") {
  const readiness = num(primary?.readiness_score);
  const trustBand = text(primary?.trust_band, "low");
  const evidenceBand = text((primary?.trust_summary as JsonRecord | null)?.evidence_band, "missing");
  const proofQuality = text((primary?.trust_summary as JsonRecord | null)?.proof_quality, "untraced");
  const label = text(primary?.label, scope === "niche" ? "niche segment" : "platform segment");
  const gapLabel = text(nextGap?.label || nextGap?.platform || nextGap?.niche);
  if (modeFromProductionState(primary?.production_state) === "primary" && proofQuality === "exact_segment") {
    return `${label} уже publishable exact policy: trust ${trustBand}, evidence ${evidenceBand}, readiness ${readiness}.`;
  }
  if (modeFromProductionState(primary?.production_state) === "primary") {
    return `${label} уже можно использовать как основной policy: trust ${trustBand}, evidence ${evidenceBand}, readiness ${readiness}.`;
  }
  if (modeFromProductionState(primary?.production_state) === "control_only") {
    return `${label} уже даёт осмысленный control-ready пакет, но ещё требует валидации. Следующий gap: ${gapLabel || "добрать trust"}.`;
  }
  return `${label} пока остаётся исследовательским policy. Главный пробел: ${gapLabel || "не хватает стабильного сигнала"}.`;
}

function summarizeUpgrade(nextUpgrade: JsonRecord | null) {
  if (!nextUpgrade) return "";
  const unlocked = text(nextUpgrade.unlocked_output);
  const trustGain = num(nextUpgrade.projected_trust_gain_score);
  const productionState = text(nextUpgrade.projected_production_state);
  const loop = text(nextUpgrade.recommended_loop);
  return [
    unlocked ? ` Следующий лучший апгрейд: ${unlocked}.` : "",
    trustGain > 0 ? ` Потенциальный trust uplift: +${trustGain}.` : "",
    productionState ? ` После закрытия gap-а состояние станет ${productionState}.` : "",
    loop ? ` Рекомендуемый loop: ${loop}.` : "",
  ].filter(Boolean).join("");
}

function buildPolicyRow(row: JsonRecord, scope: "niche" | "platform") {
  const primary = (row.primary && typeof row.primary === "object" ? row.primary : null) as JsonRecord | null;
  const nextGap = (row.next_gap && typeof row.next_gap === "object" ? row.next_gap : null) as JsonRecord | null;
  const nextUpgrade = (row.next_upgrade && typeof row.next_upgrade === "object" ? row.next_upgrade : null) as JsonRecord | null;
  const trustSummary = (primary?.trust_summary && typeof primary.trust_summary === "object" ? primary.trust_summary : {}) as JsonRecord;
  const outcomeStatus = text(trustSummary.outcome_status, "no_feedback");
  const policyMode = outcomeAdjustedPolicyMode(modeFromProductionState(primary?.production_state), outcomeStatus);
  const proofQuality = text(trustSummary.proof_quality, "untraced");
  const publishableExact = text(primary?.production_state) === "ready_now" && proofQuality === "exact_segment";
  const brief = (primary?.creative_brief && typeof primary.creative_brief === "object" ? primary.creative_brief : {}) as JsonRecord;
  const hypothesis = (primary?.hypothesis && typeof primary.hypothesis === "object" ? primary.hypothesis : {}) as JsonRecord;
  const decision = (primary?.content_decision && typeof primary.content_decision === "object" ? primary.content_decision : {}) as JsonRecord;
  return {
    [scope]: row[scope],
    label: text(row.label || row[scope]),
    policy_mode: policyMode,
    automation_allowed: policyMode !== "research_only",
    trust_band: text(primary?.trust_band, "low"),
    evidence_band: text(trustSummary.evidence_band, "missing"),
    publishable_exact: publishableExact,
    proof_quality: proofQuality,
    outcome_status: outcomeStatus,
    outcome_confidence: text(trustSummary.outcome_confidence, "none"),
    readiness_score: num(primary?.readiness_score),
    stability_score: num(trustSummary.stability_score),
    brief_title: text(brief.title || primary?.pattern_title || primary?.label),
    brief_hook: text(brief.hook),
    retention: text(brief.retention),
    structure: text(brief.structure),
    success_metric: text(decision.success_metric || hypothesis.success_metric),
    decision_title: text(decision.title),
    decision: text(decision.decision, policyMode),
    hypothesis_title: text(hypothesis.title),
    hypothesis: text(hypothesis.text),
    guardrails: list(decision.guardrails, 4),
    do_not_copy: list(brief.do_not_copy, 4),
    why: list(primary?.trust_why, 4),
    blockers: list(trustSummary.blockers, 4),
    next_gap: nextGap,
    next_upgrade: nextUpgrade,
    coverage_labels: list(row.coverage_labels, 20),
    policy_reason: [
      defaultPolicyReason(primary, nextGap, scope),
      summarizeUpgrade(nextUpgrade),
      outcomeStatus === "weak" ? "Market outcome слабый: policy принудительно опущен в research_only." : "",
      outcomeStatus === "promising" && modeFromProductionState(primary?.production_state) === "primary"
        ? "Market outcome ещё только формируется: primary policy понижен до control_only."
        : "",
      publishableExact ? "Это publishable exact segment: его нужно предпочитать transfer-ready альтернативам." : "",
    ].filter(Boolean).join(" "),
  };
}

function buildSegmentPolicyRow(row: JsonRecord) {
  const trustSummary = (row.trust_summary && typeof row.trust_summary === "object" ? row.trust_summary : {}) as JsonRecord;
  const upgradeForecast = (row.upgrade_forecast && typeof row.upgrade_forecast === "object" ? row.upgrade_forecast : null) as JsonRecord | null;
  const outcomeStatus = text(trustSummary.outcome_status, "no_feedback");
  const baseMode = modeFromProductionState(row.production_state);
  const policyMode = outcomeAdjustedPolicyMode(baseMode, outcomeStatus);
  const proofQuality = text(trustSummary.proof_quality, "untraced");
  const publishableExact = text(row.production_state) === "ready_now" && proofQuality === "exact_segment";
  const decisionPriorityScore = Math.round(
    Math.min(100,
      num(row.readiness_score) * 0.55
      + (text(row.trust_band) === "high" ? 18 : text(row.trust_band) === "medium" ? 10 : 4)
      + (text(trustSummary.evidence_band) === "stable" ? 16 : text(trustSummary.evidence_band) === "forming" ? 8 : 0)
      + Math.min(20, num(upgradeForecast?.projected_trust_gain_score) * 0.6)
      + (publishableExact ? 10 : 0)
    ),
  );
  const label = text(row.label, `${text(row.niche)} × ${text(row.platform)}`);
  return {
    label,
    niche: text(row.niche),
    platform: text(row.platform),
    policy_mode: policyMode,
    automation_allowed: policyMode !== "research_only",
    trust_band: text(row.trust_band, "low"),
    evidence_band: text(trustSummary.evidence_band, "missing"),
    proof_quality: proofQuality,
    publishable_exact: publishableExact,
    outcome_status: outcomeStatus,
    outcome_confidence: text(trustSummary.outcome_confidence, "none"),
    readiness_score: num(row.readiness_score),
    decision_priority_score: decisionPriorityScore,
    upgrade_forecast: upgradeForecast,
    next_upgrade: upgradeForecast,
    brief_hook: text(((row.creative_brief as JsonRecord | null)?.hook)),
    decision: text(((row.content_decision as JsonRecord | null)?.decision)),
    hypothesis: text(((row.hypothesis as JsonRecord | null)?.text)),
    policy_reason: [
      defaultPolicyReason(row, upgradeForecast, "niche"),
      summarizeUpgrade(upgradeForecast),
      outcomeStatus === "weak" ? "Market outcome слабый: segment policy принудительно опущен в research_only." : "",
      outcomeStatus === "promising" && baseMode === "primary"
        ? "Market outcome ещё только формируется: segment policy понижен до control_only."
        : "",
      publishableExact ? "Это publishable exact segment: его нужно поднимать выше transfer-ready альтернатив." : "",
    ].filter(Boolean).join(" "),
  };
}

export function buildReelsBrainGenerationPolicy(input: {
  segmentSolutionMatrix?: {
    summary?: JsonRecord | null;
    by_niche?: JsonRecord[];
    by_platform?: JsonRecord[];
    by_segment?: JsonRecord[];
  } | null;
}) {
  const byNiche = Array.isArray(input.segmentSolutionMatrix?.by_niche)
    ? input.segmentSolutionMatrix?.by_niche.map((row) => buildPolicyRow(row, "niche"))
    : [];
  const byPlatform = Array.isArray(input.segmentSolutionMatrix?.by_platform)
    ? input.segmentSolutionMatrix?.by_platform.map((row) => buildPolicyRow(row, "platform"))
    : [];
  const bySegment = Array.isArray(input.segmentSolutionMatrix?.by_segment)
      ? input.segmentSolutionMatrix?.by_segment.slice(0, 12).map((row) => buildSegmentPolicyRow(row))
    : [];

  return {
    summary: {
      total_segments: num(input.segmentSolutionMatrix?.summary?.total_segments),
      ready_now: num(input.segmentSolutionMatrix?.summary?.ready_now),
      controlled_test: num(input.segmentSolutionMatrix?.summary?.controlled_test),
      research_only: num(input.segmentSolutionMatrix?.summary?.research_only),
      high_trust_segments: num(input.segmentSolutionMatrix?.summary?.high_trust_segments),
      publishable_exact_segments: num(input.segmentSolutionMatrix?.summary?.publishable_exact_segments),
      primary_niches: byNiche.filter((row) => row.policy_mode === "primary").length,
      primary_exact_niches: byNiche.filter((row) => row.policy_mode === "primary" && row.publishable_exact).length,
      primary_platforms: byPlatform.filter((row) => row.policy_mode === "primary").length,
      primary_exact_platforms: byPlatform.filter((row) => row.policy_mode === "primary" && row.publishable_exact).length,
    },
    global_default: bySegment[0] || null,
    by_niche: byNiche,
    by_platform: byPlatform,
    by_segment: bySegment,
  };
}
