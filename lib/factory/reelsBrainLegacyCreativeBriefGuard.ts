function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function list(value: unknown, limit = 6) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function legacyBriefTransferNote(niche: string, platform: string) {
  return `Legacy decision-pack не доказывает exact segment ${niche} × ${platform}; использовать только как control/brief ladder.`;
}

export function normalizeLegacyCreativeBrief(
  payload: Record<string, unknown>,
  requested: { niche: string; platform: string },
) {
  const creativeBrief = (payload.creative_brief && typeof payload.creative_brief === "object"
    ? payload.creative_brief
    : {}) as Record<string, unknown>;
  const evidence = (payload.evidence && typeof payload.evidence === "object"
    ? payload.evidence
    : {}) as Record<string, unknown>;
  const trustDecision = (evidence.trust_decision && typeof evidence.trust_decision === "object"
    ? evidence.trust_decision
    : {}) as Record<string, unknown>;
  const decisionPack = (payload.decision_pack && typeof payload.decision_pack === "object"
    ? payload.decision_pack
    : {}) as Record<string, unknown>;
  const selectedPattern = (payload.selected_pattern && typeof payload.selected_pattern === "object"
    ? payload.selected_pattern
    : {}) as Record<string, unknown>;

  return {
    ...payload,
    ok: true,
    source: text(payload.source) || "legacy_decision_pack",
    requested_segment: {
      niche: requested.niche,
      platform: requested.platform,
    },
    fit_summary: {
      mode: "broad_transfer",
      requested_niche: requested.niche,
      requested_platform: requested.platform,
      matched_niche: text(payload.niche),
      matched_platform: text(payload.platform),
      is_exact_match: false,
      transfer_note: legacyBriefTransferNote(requested.niche, requested.platform),
    },
    selected_pattern: {
      pattern_id: text(selectedPattern.pattern_id || payload.pattern_id) || null,
      hook_type: text(selectedPattern.hook_type || payload.hook_type) || null,
      structure_type: text(selectedPattern.structure_type || payload.structure_type) || null,
      retention_mechanism: text(selectedPattern.retention_mechanism || payload.retention_mechanism || creativeBrief.retention_mechanic) || null,
      quality_label: text(selectedPattern.quality_label || payload.quality_label) || null,
      trust_scope: text(selectedPattern.trust_scope || trustDecision.selected_scope) || "meta",
    },
    quality_gate: {
      status: "needs_validation",
      source: "legacy_decision_pack_guard",
      min_trust_score: 82,
      min_corpus_score: 76,
      min_market_score: 58,
      min_stable_patterns: 2,
      min_evidence_refs: 2,
      allowed_generation_modes: ["control_ready", "brief_only"],
      blocked_reasons: Array.from(new Set([
        ...list(payload.quality_reasons, 5),
        legacyBriefTransferNote(requested.niche, requested.platform),
      ])),
      exact_segment_ready: false,
    },
    content_decision: {
      title: text(payload.pattern_title) || "Creative brief",
      decision: "validate",
      success_metric: text(decisionPack.strategy_note) || "Нужен control-ready тест перед продовым запуском.",
      guardrails: [
        "Не считать это exact-ready решением без segment-level proof.",
        "Сначала прогонять как control-ready тест на нужном niche × platform.",
      ],
      execution_note: "Legacy decision-pack: использовать только как control/brief ladder, пока exact-proof не закрыт.",
      next_step: "Добрать exact-segment proof и только потом переводить в primary lane.",
    },
  };
}
