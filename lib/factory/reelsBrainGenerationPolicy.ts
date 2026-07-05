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

function buildPolicyRow(row: JsonRecord, scope: "niche" | "platform") {
  const primary = (row.primary && typeof row.primary === "object" ? row.primary : null) as JsonRecord | null;
  const nextGap = (row.next_gap && typeof row.next_gap === "object" ? row.next_gap : null) as JsonRecord | null;
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
    coverage_labels: list(row.coverage_labels, 20),
    policy_reason: [
      defaultPolicyReason(primary, nextGap, scope),
      outcomeStatus === "weak" ? "Market outcome слабый: policy принудительно опущен в research_only." : "",
      outcomeStatus === "promising" && modeFromProductionState(primary?.production_state) === "primary"
        ? "Market outcome ещё только формируется: primary policy понижен до control_only."
        : "",
      publishableExact ? "Это publishable exact segment: его нужно предпочитать transfer-ready альтернативам." : "",
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
      ? input.segmentSolutionMatrix?.by_segment.slice(0, 12).map((row) => ({
        label: text(row.label),
        niche: text(row.niche),
        platform: text(row.platform),
        policy_mode: modeFromProductionState(row.production_state),
        trust_band: text(row.trust_band, "low"),
        evidence_band: text(((row.trust_summary as JsonRecord | null)?.evidence_band), "missing"),
        proof_quality: text(((row.trust_summary as JsonRecord | null)?.proof_quality), "untraced"),
        publishable_exact: text(row.production_state) === "ready_now" && text(((row.trust_summary as JsonRecord | null)?.proof_quality), "untraced") === "exact_segment",
        readiness_score: num(row.readiness_score),
        brief_hook: text(((row.creative_brief as JsonRecord | null)?.hook)),
        decision: text(((row.content_decision as JsonRecord | null)?.decision)),
        hypothesis: text(((row.hypothesis as JsonRecord | null)?.text)),
      }))
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
