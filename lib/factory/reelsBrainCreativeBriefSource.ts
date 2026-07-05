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

function candidateScore(candidate: { source: "segment_solution" | "platform_matrix" | "niche_matrix"; row: JsonRecord }) {
  const trustSummary = (candidate.row.trust_summary || {}) as JsonRecord;
  return sourcePreference(candidate.source)
    + productionRank(candidate.row.production_state) * 12
    + trustRank(candidate.row.trust_band) * 10
    + num(trustSummary.stability_score) * 0.45
    + num(candidate.row.readiness_score) * 0.25
    + outcomePenalty(trustSummary.outcome_status);
}

function buildAlternative(row: JsonRecord, source: "segment_solution" | "platform_matrix" | "niche_matrix") {
  const brief = (row.creative_brief || {}) as JsonRecord;
  const hypothesis = (row.hypothesis || {}) as JsonRecord;
  const contentDecision = (row.content_decision || {}) as JsonRecord;
  const trustSummary = (row.trust_summary || {}) as JsonRecord;
  return {
    source,
    label: text(row.label, `${row.niche || "niche"} × ${row.platform || "platform"}`),
    niche: text(row.niche),
    platform: text(row.platform),
    trust_band: text(row.trust_band, "low"),
    evidence_band: text(trustSummary.evidence_band, "missing"),
    outcome_status: text(trustSummary.outcome_status, "no_feedback"),
    production_state: text(row.production_state, "research_only"),
    readiness_score: num(row.readiness_score),
    stability_score: num(trustSummary.stability_score),
    hook: text(brief.hook),
    hypothesis: text(hypothesis.text),
    content_decision: text(contentDecision.decision || contentDecision.title),
  };
}

function buildResponseFromSolution(
  row: JsonRecord,
  source: "segment_solution" | "platform_matrix" | "niche_matrix",
  candidates: Array<{ source: "segment_solution" | "platform_matrix" | "niche_matrix"; row: JsonRecord }>,
) {
  const brief = (row.creative_brief || {}) as JsonRecord;
  const hypothesis = (row.hypothesis || {}) as JsonRecord;
  const contentDecision = (row.content_decision || {}) as JsonRecord;
  const trustSummary = (row.trust_summary || {}) as JsonRecord;
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
  const sourceTrace = candidates.map((candidate, index) => ({
    rank: index + 1,
    source: candidate.source,
    label: text(candidate.row.label, `${candidate.row.niche || "niche"} × ${candidate.row.platform || "platform"}`),
    outcome_status: text((((candidate.row.trust_summary || {}) as JsonRecord).outcome_status), "no_feedback"),
    readiness_score: num(candidate.row.readiness_score),
    trust_band: text(candidate.row.trust_band, "low"),
    evidence_band: text(((candidate.row.trust_summary || {}) as JsonRecord).evidence_band, "missing"),
    production_state: text(candidate.row.production_state, "research_only"),
    candidate_score: Math.round(candidateScore(candidate) * 10) / 10,
    chosen: candidate.row === row && candidate.source === source,
  }));
  const decisionPack = {
    trust_mode: text(row.production_state, "research_only"),
    trust_band: text(row.trust_band, "low"),
    evidence_band: text(trustSummary.evidence_band, "missing"),
    readiness_score: num(row.readiness_score),
    stability_score: num(trustSummary.stability_score),
    why: list(row.trust_why, 5),
    blockers: list(trustSummary.blockers, 5),
    guardrails: Array.from(new Set([
      ...list(contentDecision.guardrails, 5),
      ...outcomeGuardrails.guardrails,
    ])).slice(0, 6),
    success_metric: text(contentDecision.success_metric || hypothesis.success_metric),
    next_step: text(contentDecision.next_step || row.next_step),
  };

  return {
    ok: true,
    source,
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
    anti_patterns: outcomeGuardrails.anti_patterns,
    trust_why: list(row.trust_why, 5),
    decision_pack: decisionPack,
    source_trace: sourceTrace,
    alternatives: candidates
      .filter((candidate) => !(candidate.row === row && candidate.source === source))
      .map((candidate) => buildAlternative(candidate.row, candidate.source))
      .slice(0, 3),
  };
}

export function selectCreativeBriefFromSegmentLayers(input: {
  niche: string;
  platform: string;
  segmentSolutions?: { items?: JsonRecord[] } | null;
  segmentSolutionMatrix?: { by_niche?: JsonRecord[]; by_platform?: JsonRecord[] } | null;
}) {
  const niche = text(input.niche);
  const platform = text(input.platform).toLowerCase();
  const exact = records(input.segmentSolutions?.items)
    .filter((row) => text(row.niche) === niche && text(row.platform).toLowerCase() === platform)
    .sort(itemSort)[0];

  const platformRow = records(input.segmentSolutionMatrix?.by_platform)
    .find((row) => text(row.platform).toLowerCase() === platform);
  const platformPrimary = asPrimary(platformRow?.primary);

  const nicheRow = records(input.segmentSolutionMatrix?.by_niche)
    .find((row) => text(row.niche) === niche);
  const nichePrimary = asPrimary(nicheRow?.primary);
  const candidates = [
    exact ? { source: "segment_solution" as const, row: exact } : null,
    platformPrimary ? { source: "platform_matrix" as const, row: platformPrimary } : null,
    nichePrimary ? { source: "niche_matrix" as const, row: nichePrimary } : null,
  ].filter(Boolean) as Array<{ source: "segment_solution" | "platform_matrix" | "niche_matrix"; row: JsonRecord }>;
  const rankedCandidates = [...candidates].sort((a, b) =>
    candidateScore(b) - candidateScore(a)
    || itemSort(a.row, b.row)
    || sourcePreference(b.source) - sourcePreference(a.source)
  );
  const selected = rankedCandidates[0] || null;

  if (selected) return buildResponseFromSolution(selected.row, selected.source, rankedCandidates);

  return null;
}
