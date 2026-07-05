import { buildReelsBrainOutcomeGuardrails } from "./reelsBrainOutcomeGuardrails";

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

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

function trustRank(value: unknown) {
  const band = text(value, "low");
  if (band === "high") return 3;
  if (band === "medium") return 2;
  return 1;
}

function productionRank(value: unknown) {
  const state = text(value, "research_only");
  if (state === "ready_now") return 3;
  if (state === "controlled_test") return 2;
  return 1;
}

function itemSort(a: JsonRecord, b: JsonRecord) {
  return productionRank(b.production_state) - productionRank(a.production_state)
    || trustRank(b.trust_band) - trustRank(a.trust_band)
    || num((b.trust_summary as JsonRecord | null)?.stability_score) - num((a.trust_summary as JsonRecord | null)?.stability_score)
    || num(b.readiness_score) - num(a.readiness_score)
    || text(a.label).localeCompare(text(b.label));
}

function asPrimary(row: unknown) {
  return row && typeof row === "object" ? row as JsonRecord : null;
}

function outcomePenalty(value: unknown) {
  const status = text(value, "no_feedback");
  if (status === "weak") return -90;
  if (status === "promising") return 6;
  if (status === "proven") return 18;
  return 0;
}

function sourcePreference(source: "segment_solution" | "platform_matrix" | "niche_matrix") {
  if (source === "segment_solution") return 24;
  if (source === "platform_matrix") return 14;
  return 10;
}

function upgradeBoost(upgradeForecast: JsonRecord | null | undefined, mode: string) {
  if (!upgradeForecast) return 0;
  const trustGain = Math.min(18, num(upgradeForecast.projected_trust_gain_score) * 0.4);
  const exactModeBoost = mode === "exact_segment" ? 6 : mode === "platform_transfer" ? 3 : 2;
  const stateBoost = text(upgradeForecast.projected_production_state) === "publishable_exact"
    ? 10
    : text(upgradeForecast.projected_production_state) === "near_publishable"
      ? 6
      : text(upgradeForecast.projected_production_state) === "controlled_test"
        ? 3
        : 0;
  return trustGain + exactModeBoost + stateBoost;
}

function fitMode(input: { requestedNiche: string; requestedPlatform: string; row: JsonRecord }) {
  const nicheMatch = text(input.row.niche) === input.requestedNiche;
  const platformMatch = text(input.row.platform).toLowerCase() === input.requestedPlatform;
  if (nicheMatch && platformMatch) return "exact_segment";
  if (platformMatch) return "platform_transfer";
  if (nicheMatch) return "niche_transfer";
  return "broad_transfer";
}

function fitPenalty(mode: string) {
  if (mode === "exact_segment") return 0;
  if (mode === "platform_transfer") return -8;
  if (mode === "niche_transfer") return -10;
  return -16;
}

function findPackRow(
  packs: JsonRecord[] | undefined,
  row: JsonRecord,
) {
  return (packs || []).find((item) =>
    text(item.niche) === text(row.niche)
    && text(item.platform).toLowerCase() === text(row.platform).toLowerCase(),
  ) || null;
}

function packGateScore(input: {
  mode: string;
  row: JsonRecord;
  packRow: JsonRecord | null;
}) {
  const qualityGate = (input.packRow?.quality_gate && typeof input.packRow.quality_gate === "object"
    ? input.packRow.quality_gate
    : {}) as JsonRecord;
  const gateStatus = text(qualityGate.status, text(input.row.production_state) === "ready_now"
    ? "ready"
    : text(input.row.production_state) === "controlled_test"
      ? "needs_validation"
      : "not_ready");
  const proofQuality = text(input.packRow?.proof_quality || input.row.proof_quality || (input.row.trust_summary as JsonRecord | null)?.proof_quality, "untraced");
  const exactPublishable = input.mode === "exact_segment" && gateStatus === "ready" && proofQuality === "exact_segment";
  if (exactPublishable) return 30;
  if (input.mode === "exact_segment" && gateStatus === "needs_validation") return 8;
  if (input.mode !== "exact_segment" && gateStatus === "ready") return 4;
  if (gateStatus === "not_ready") return -6;
  return 0;
}

function rowUpgradeForecast(
  row: JsonRecord,
  source: "segment_solution" | "platform_matrix" | "niche_matrix",
  matrix?: { by_segment?: JsonRecord[]; by_platform?: JsonRecord[]; by_niche?: JsonRecord[] } | null,
) {
  const direct = asPrimary(row.upgrade_forecast);
  if (direct) return direct;
  if (!matrix) return null;
  if (source === "segment_solution") {
    const bySegment = records(matrix.by_segment);
    const match = bySegment.find((item) =>
      text(item.niche) === text(row.niche)
      && text(item.platform).toLowerCase() === text(row.platform).toLowerCase(),
    ) || null;
    return asPrimary(match && typeof match === "object" ? (match as JsonRecord).upgrade_forecast : null);
  }
  if (source === "platform_matrix") {
    const byPlatform = records(matrix.by_platform);
    const match = byPlatform.find((item) => text(item.platform).toLowerCase() === text(row.platform).toLowerCase()) || null;
    return asPrimary(match && typeof match === "object" ? (match as JsonRecord).next_upgrade : null);
  }
  const byNiche = records(matrix.by_niche);
  const match = byNiche.find((item) => text(item.niche) === text(row.niche)) || null;
  return asPrimary(match && typeof match === "object" ? (match as JsonRecord).next_upgrade : null);
}

function candidateScore(candidate: {
  source: "segment_solution" | "platform_matrix" | "niche_matrix";
  row: JsonRecord;
  requestedNiche: string;
  requestedPlatform: string;
  packRow?: JsonRecord | null;
  upgradeForecast?: JsonRecord | null;
}) {
  const trustSummary = (candidate.row.trust_summary || {}) as JsonRecord;
  const mode = fitMode({
    requestedNiche: candidate.requestedNiche,
    requestedPlatform: candidate.requestedPlatform,
    row: candidate.row,
  });
  return sourcePreference(candidate.source)
    + productionRank(candidate.row.production_state) * 12
    + trustRank(candidate.row.trust_band) * 10
    + num(trustSummary.stability_score) * 0.45
    + num(candidate.row.readiness_score) * 0.25
    + outcomePenalty(trustSummary.outcome_status)
    + packGateScore({
      mode,
      row: candidate.row,
      packRow: candidate.packRow || null,
    })
    + upgradeBoost(candidate.upgradeForecast, mode)
    + fitPenalty(mode);
}

function buildAlternative(
  row: JsonRecord,
  source: "segment_solution" | "platform_matrix" | "niche_matrix",
  requested: { niche: string; platform: string },
  upgradeForecast?: JsonRecord | null,
) {
  const brief = (row.creative_brief || {}) as JsonRecord;
  const hypothesis = (row.hypothesis || {}) as JsonRecord;
  const contentDecision = (row.content_decision || {}) as JsonRecord;
  const trustSummary = (row.trust_summary || {}) as JsonRecord;
  const mode = fitMode({
    requestedNiche: requested.niche,
    requestedPlatform: requested.platform,
    row,
  });
  const qualityGate = (row.quality_gate && typeof row.quality_gate === "object" ? row.quality_gate : {}) as JsonRecord;
  const proofQuality = text(row.proof_quality || (trustSummary as JsonRecord).proof_quality, "untraced");
  const exactSegmentReady = mode === "exact_segment" && text(qualityGate.status) === "ready" && proofQuality === "exact_segment";
  return {
    source,
    fit_mode: mode,
    label: text(row.label, `${row.niche || "niche"} × ${row.platform || "platform"}`),
    niche: text(row.niche),
    platform: text(row.platform),
    trust_band: text(row.trust_band, "low"),
    evidence_band: text(trustSummary.evidence_band, "missing"),
    outcome_status: text(trustSummary.outcome_status, "no_feedback"),
    production_state: text(row.production_state, "research_only"),
    readiness_score: num(row.readiness_score),
    stability_score: num(trustSummary.stability_score),
    exact_segment_ready: exactSegmentReady,
    publishable_exact: exactSegmentReady,
    upgrade_forecast: upgradeForecast ? {
      unlocked_output: text(upgradeForecast.unlocked_output),
      projected_production_state: text(upgradeForecast.projected_production_state),
      projected_trust_gain_score: num(upgradeForecast.projected_trust_gain_score),
      projected_trust_gain_band: text(upgradeForecast.projected_trust_gain_band),
      recommended_loop: text(upgradeForecast.recommended_loop),
    } : null,
    hook: text(brief.hook),
    hypothesis: text(hypothesis.text),
    content_decision: text(contentDecision.decision || contentDecision.title),
  };
}

function buildResponseFromSolution(
  row: JsonRecord,
  source: "segment_solution" | "platform_matrix" | "niche_matrix",
  candidates: Array<{
    source: "segment_solution" | "platform_matrix" | "niche_matrix";
    row: JsonRecord;
    requestedNiche: string;
    requestedPlatform: string;
    packRow?: JsonRecord | null;
    upgradeForecast?: JsonRecord | null;
  }>,
  input: {
    requestedNiche: string;
    requestedPlatform: string;
    segmentGenerationPacks?: { items?: JsonRecord[] } | null;
    segmentSolutionMatrix?: { by_niche?: JsonRecord[]; by_platform?: JsonRecord[]; by_segment?: JsonRecord[] } | null;
  },
) {
  const brief = (row.creative_brief || {}) as JsonRecord;
  const hypothesis = (row.hypothesis || {}) as JsonRecord;
  const contentDecision = (row.content_decision || {}) as JsonRecord;
  const trustSummary = (row.trust_summary || {}) as JsonRecord;
  const mode = fitMode({
    requestedNiche: input.requestedNiche,
    requestedPlatform: input.requestedPlatform,
    row,
  });
  const packRow = records(input.segmentGenerationPacks?.items).find((item) =>
    text(item.niche) === text(row.niche) && text(item.platform).toLowerCase() === text(row.platform).toLowerCase(),
  ) || null;
  const packGate = (packRow?.quality_gate && typeof packRow.quality_gate === "object" ? packRow.quality_gate : {}) as JsonRecord;
  const baseGateStatus = text(packGate.status, text(row.production_state) === "ready_now"
    ? "ready"
    : text(row.production_state) === "controlled_test"
      ? "needs_validation"
      : "not_ready");
  const effectiveGateStatus = mode === "exact_segment"
    ? baseGateStatus
    : baseGateStatus === "ready"
      ? "needs_validation"
      : baseGateStatus;
  const transferReasons = mode === "exact_segment"
    ? []
    : [
        mode === "platform_transfer"
          ? `Решение перенесено с другой ниши внутри ${text(row.platform)}; exact segment ${input.requestedNiche} × ${input.requestedPlatform} ещё не доказан.`
          : mode === "niche_transfer"
            ? `Решение перенесено с другой платформы внутри ${text(row.niche)}; exact segment ${input.requestedNiche} × ${input.requestedPlatform} ещё не доказан.`
            : `Решение перенесено из смежного сегмента ${text(row.niche)} × ${text(row.platform)}; exact segment ещё не доказан.`,
      ];
  const outcomeGuardrails = buildReelsBrainOutcomeGuardrails({
    outcome_status: text(trustSummary.outcome_status),
    outcome_confidence: text(trustSummary.outcome_confidence),
    outcome_posts: num(trustSummary.outcome_posts),
    outcome_winners: num(trustSummary.outcome_winners),
    outcome_losers: num(trustSummary.outcome_losers),
    outcome_trust_action: text(trustSummary.outcome_trust_action),
    outcome_evidence: text(trustSummary.outcome_evidence),
    platform: text(row.platform),
  });
  const selectedUpgradeForecast = rowUpgradeForecast(row, source, input.segmentSolutionMatrix || null);
  const sourceTrace = candidates.map((candidate, index) => ({
    rank: index + 1,
    source: candidate.source,
    fit_mode: fitMode({
      requestedNiche: candidate.requestedNiche,
      requestedPlatform: candidate.requestedPlatform,
      row: candidate.row,
    }),
    label: text(candidate.row.label, `${candidate.row.niche || "niche"} × ${candidate.row.platform || "platform"}`),
    outcome_status: text((((candidate.row.trust_summary || {}) as JsonRecord).outcome_status), "no_feedback"),
    readiness_score: num(candidate.row.readiness_score),
    trust_band: text(candidate.row.trust_band, "low"),
    evidence_band: text(((candidate.row.trust_summary || {}) as JsonRecord).evidence_band, "missing"),
    production_state: text(candidate.row.production_state, "research_only"),
    pack_gate_status: text((((candidate.packRow || {}) as JsonRecord).quality_gate as JsonRecord | null)?.status, "unknown"),
    publishable_exact: Boolean(
      fitMode({
        requestedNiche: candidate.requestedNiche,
        requestedPlatform: candidate.requestedPlatform,
        row: candidate.row,
      }) === "exact_segment"
      && text((((candidate.packRow || {}) as JsonRecord).quality_gate as JsonRecord | null)?.status) === "ready"
      && text((candidate.packRow || candidate.row).proof_quality || (((candidate.row.trust_summary || {}) as JsonRecord).proof_quality), "untraced") === "exact_segment",
    ),
    projected_trust_gain_score: num(candidate.upgradeForecast?.projected_trust_gain_score),
    projected_production_state: text(candidate.upgradeForecast?.projected_production_state),
    candidate_score: Math.round(candidateScore(candidate) * 10) / 10,
    chosen: candidate.row === row && candidate.source === source,
  }));
  const allowedModes = Array.isArray(packGate.allowed_generation_modes)
    ? packGate.allowed_generation_modes.map((item) => text(item)).filter(Boolean)
    : [];
  const blockedReasons = Array.from(new Set([
    ...list(packGate.blocked_reasons, 6),
    ...transferReasons,
  ])).filter(Boolean);
  const qualityGate = {
    status: effectiveGateStatus,
    source: packRow ? "segment_generation_pack" : "segment_solution_fallback",
    min_trust_score: num(packGate.min_trust_score),
    min_corpus_score: num(packGate.min_corpus_score),
    min_market_score: num(packGate.min_market_score),
    min_stable_patterns: num(packGate.min_stable_patterns),
    min_evidence_refs: num(packGate.min_evidence_refs),
    allowed_generation_modes: mode === "exact_segment"
      ? allowedModes
      : Array.from(new Set(["control_ready", "brief_only"].filter((value) => allowedModes.length ? allowedModes.includes(value) || value === "brief_only" : true))),
    blocked_reasons: blockedReasons,
    exact_segment_ready: mode === "exact_segment" && effectiveGateStatus === "ready",
  };
  const decisionPack = {
    trust_mode: text(row.production_state, "research_only"),
    trust_band: text(row.trust_band, "low"),
    fit_mode: mode,
    evidence_band: text(trustSummary.evidence_band, "missing"),
    readiness_score: num(row.readiness_score),
    stability_score: num(trustSummary.stability_score),
    why: list(row.trust_why, 5),
    blockers: Array.from(new Set([
      ...list(trustSummary.blockers, 5),
      ...blockedReasons,
    ])).slice(0, 6),
    guardrails: Array.from(new Set([
      ...list(contentDecision.guardrails, 5),
      ...outcomeGuardrails.guardrails,
    ])).slice(0, 6),
    success_metric: text(contentDecision.success_metric || hypothesis.success_metric),
    next_step: text(contentDecision.next_step || row.next_step),
    recommended_upgrade: selectedUpgradeForecast ? {
      unlocked_output: text(selectedUpgradeForecast.unlocked_output),
      projected_production_state: text(selectedUpgradeForecast.projected_production_state),
      projected_trust_gain_score: num(selectedUpgradeForecast.projected_trust_gain_score),
      projected_trust_gain_band: text(selectedUpgradeForecast.projected_trust_gain_band),
      recommended_loop: text(selectedUpgradeForecast.recommended_loop),
      unlocked_next_step: text(selectedUpgradeForecast.unlocked_next_step),
    } : null,
  };

  return {
    ok: true,
    source,
    requested_segment: {
      niche: input.requestedNiche,
      platform: input.requestedPlatform,
    },
    fit_summary: {
      mode,
      requested_niche: input.requestedNiche,
      requested_platform: input.requestedPlatform,
      matched_niche: text(row.niche),
      matched_platform: text(row.platform),
      is_exact_match: mode === "exact_segment",
      transfer_note: transferReasons[0] || "",
    },
    selected_pattern: {
      pattern_id: text(row.label || `${row.niche || "niche"}:${row.platform || "platform"}`),
      hook_type: null,
      structure_type: null,
      retention_mechanism: text(brief.retention),
      quality_label: text(row.production_state),
      trust_scope: source === "segment_solution" ? "segment" : source === "platform_matrix" ? "platform" : "niche",
    },
    niche: text(row.niche),
    platform: text(row.platform),
    label: text(row.label, `${row.niche || "niche"} × ${row.platform || "platform"}`),
    op_score: num(row.readiness_score),
    confidence_gate: text(row.trust_band, "low"),
    trust_mode: text(row.production_state, "research_only"),
    pattern_title: text(brief.title || row.label, "Creative brief"),
    creative_brief: {
      hook: text(brief.hook),
      retention_mechanic: text(brief.retention),
      structure: text(brief.structure),
      second_by_second: list(brief.second_by_second, 5),
      visual_recipe: list(brief.visual_recipe, 5),
      audio_strategy: list(brief.audio_strategy, 4),
      product_fit: list(brief.product_fit, 4),
      copy_as_mechanic: list(brief.copy_as_mechanic, 4),
      do_not_copy: Array.from(new Set([
        ...list(brief.do_not_copy, 4),
        ...outcomeGuardrails.do_not_copy,
      ])).slice(0, 5),
    },
    hypothesis: {
      title: text(hypothesis.title, "Hypothesis"),
      text: text(hypothesis.text),
      success_metric: text(hypothesis.success_metric || contentDecision.success_metric),
    },
    content_decision: {
      title: text(contentDecision.title || contentDecision.action_title, "Content decision"),
      decision: text(contentDecision.decision, "research"),
      success_metric: text(contentDecision.success_metric || hypothesis.success_metric),
      guardrails: Array.from(new Set([
        ...list(contentDecision.guardrails, 5),
        ...outcomeGuardrails.guardrails,
      ])).slice(0, 6),
      execution_note: text(contentDecision.execution_note),
      next_step: text(contentDecision.next_step || row.next_step),
    },
    trust_summary: {
      band: text(row.trust_band, "low"),
      evidence_band: text(trustSummary.evidence_band, "missing"),
      stability_score: num(trustSummary.stability_score),
      signals: list(trustSummary.signals, 4),
      blockers: list(trustSummary.blockers, 5),
      outcome_status: text(trustSummary.outcome_status, "no_feedback"),
      outcome_confidence: text(trustSummary.outcome_confidence, "none"),
      outcome_posts: num(trustSummary.outcome_posts),
      outcome_winners: num(trustSummary.outcome_winners),
      outcome_losers: num(trustSummary.outcome_losers),
    },
    quality_gate: qualityGate,
    upgrade_forecast: selectedUpgradeForecast ? {
      unlocked_output: text(selectedUpgradeForecast.unlocked_output),
      projected_production_state: text(selectedUpgradeForecast.projected_production_state),
      projected_trust_gain_score: num(selectedUpgradeForecast.projected_trust_gain_score),
      projected_trust_gain_band: text(selectedUpgradeForecast.projected_trust_gain_band),
      recommended_loop: text(selectedUpgradeForecast.recommended_loop),
      unlocked_next_step: text(selectedUpgradeForecast.unlocked_next_step),
    } : null,
    anti_patterns: outcomeGuardrails.anti_patterns,
    trust_why: list(row.trust_why, 5),
    decision_pack: decisionPack,
    source_trace: sourceTrace,
    alternatives: candidates
      .filter((candidate) => !(candidate.row === row && candidate.source === source))
      .map((candidate) => buildAlternative(candidate.row, candidate.source, {
        niche: input.requestedNiche,
        platform: input.requestedPlatform,
      }, candidate.upgradeForecast || null))
      .slice(0, 3),
  };
}

export function selectCreativeBriefFromSegmentLayers(input: {
  niche: string;
  platform: string;
  segmentSolutions?: { items?: JsonRecord[] } | null;
  segmentSolutionMatrix?: { by_niche?: JsonRecord[]; by_platform?: JsonRecord[]; by_segment?: JsonRecord[] } | null;
  segmentGenerationPacks?: { items?: JsonRecord[] } | null;
  strictExact?: boolean;
}) {
  const niche = text(input.niche);
  const platform = text(input.platform).toLowerCase();
  const exact = records(input.segmentSolutions?.items)
    .filter((row) => text(row.niche) === niche && text(row.platform).toLowerCase() === platform)
    .sort(itemSort)[0];
  const packs = records(input.segmentGenerationPacks?.items);

  const platformRow = records(input.segmentSolutionMatrix?.by_platform)
    .find((row) => text(row.platform).toLowerCase() === platform);
  const platformPrimary = asPrimary(platformRow?.primary);

  const nicheRow = records(input.segmentSolutionMatrix?.by_niche)
    .find((row) => text(row.niche) === niche);
  const nichePrimary = asPrimary(nicheRow?.primary);
  const candidates = [
    exact ? {
      source: "segment_solution" as const,
      row: exact,
      requestedNiche: niche,
      requestedPlatform: platform,
      packRow: findPackRow(packs, exact),
      upgradeForecast: rowUpgradeForecast(exact, "segment_solution", input.segmentSolutionMatrix || null),
    } : null,
    platformPrimary ? {
      source: "platform_matrix" as const,
      row: platformPrimary,
      requestedNiche: niche,
      requestedPlatform: platform,
      packRow: findPackRow(packs, platformPrimary),
      upgradeForecast: rowUpgradeForecast(platformPrimary, "platform_matrix", input.segmentSolutionMatrix || null),
    } : null,
    nichePrimary ? {
      source: "niche_matrix" as const,
      row: nichePrimary,
      requestedNiche: niche,
      requestedPlatform: platform,
      packRow: findPackRow(packs, nichePrimary),
      upgradeForecast: rowUpgradeForecast(nichePrimary, "niche_matrix", input.segmentSolutionMatrix || null),
    } : null,
  ].filter(Boolean) as Array<{
    source: "segment_solution" | "platform_matrix" | "niche_matrix";
    row: JsonRecord;
    requestedNiche: string;
    requestedPlatform: string;
    packRow?: JsonRecord | null;
    upgradeForecast?: JsonRecord | null;
  }>;
  const rankedCandidates = [...candidates].sort((a, b) =>
    candidateScore(b) - candidateScore(a)
    || itemSort(a.row, b.row)
    || sourcePreference(b.source) - sourcePreference(a.source)
  );
  const selected = rankedCandidates[0] || null;

  if (selected) {
    const response = buildResponseFromSolution(selected.row, selected.source, rankedCandidates, {
      requestedNiche: niche,
      requestedPlatform: platform,
      segmentGenerationPacks: input.segmentGenerationPacks || null,
      segmentSolutionMatrix: input.segmentSolutionMatrix || null,
    });
    if (input.strictExact && !response.quality_gate?.exact_segment_ready) {
      return null;
    }
    return response;
  }

  return null;
}
