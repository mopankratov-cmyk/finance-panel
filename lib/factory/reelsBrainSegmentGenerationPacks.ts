type SegmentDecisionItem = {
  niche?: string;
  platform?: string;
  trust_score?: number;
  decision_grade?: "ship" | "validate" | "prepare" | "research" | string;
  generation_mode?: "decision_ready" | "control_ready" | "brief_only" | "research_only" | string;
  ready_for_generation?: boolean;
  evidence_status?: string;
  playbook_status?: string;
  atlas_status?: string;
  corpus_score?: number;
  market_score?: number;
  stable_pattern_count?: number;
  outcome_status?: string;
  outcome_confidence?: string;
  outcome_boost?: number;
  outcome_posts?: number;
  outcome_winners?: number;
  outcome_losers?: number;
  outcome_trust_action?: string;
  outcome_evidence?: string;
  brief?: {
    title?: string;
    hook?: string;
    retention?: string;
    second_by_second?: string[];
    visual_recipe?: string[];
    audio_strategy?: string[];
    product_fit?: string[];
    copy_as_mechanic?: string[];
    do_not_copy?: string[];
    evidence_refs?: number;
    confidence?: string;
  };
  action?: {
    title?: string;
    decision?: string;
    success_metric?: string;
    guardrails?: string[];
    structure?: string;
  };
  hypothesis?: {
    title?: string;
    text?: string;
    success_metric?: string;
  };
  generator_payload?: {
    hook?: string;
    retention?: string;
    structure?: string;
    visual_recipe?: string[];
    audio_strategy?: string[];
    product_fit?: string[];
    copy_as_mechanic?: string[];
    do_not_copy?: string[];
  };
  why_now?: string;
  next_step?: string;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function list(value: unknown, limit = 4): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function gateStatus(item: SegmentDecisionItem) {
  const grade = text(item.decision_grade);
  if (grade === "ship") return "ready";
  if (grade === "validate") return "needs_validation";
  return "not_ready";
}

function blockedReasons(item: SegmentDecisionItem) {
  const out: string[] = [];
  if (num(item.trust_score) < 82) out.push("trust score ниже decision-grade порога");
  if (num(item.corpus_score) < 70) out.push("корпус сегмента ещё недостаточно плотный");
  if (num(item.stable_pattern_count) < 2) out.push("мало stable patterns");
  if (num(item.brief?.evidence_refs) < 2) out.push("недостаточно reference evidence");
  if (text(item.generator_payload?.hook).length < 4) out.push("hook ещё не нормализован");
  if (text(item.generator_payload?.structure).length < 3) out.push("structure ещё не нормализована");
  if (text(item.outcome_status) === "weak") out.push("рынок пока не подтверждает сегмент outcome-постами");
  return out;
}

export function buildReelsBrainSegmentGenerationPacks(input: {
  segmentDecisionDeck?: {
    items?: SegmentDecisionItem[];
  };
  limit?: number;
}) {
  const items = (input.segmentDecisionDeck?.items || [])
    .map((item) => {
      const status = gateStatus(item);
      const blockers = blockedReasons(item);
      const qualityGate = {
        status,
        min_trust_score: status === "ready" ? 82 : status === "needs_validation" ? 66 : 48,
        min_corpus_score: status === "ready" ? 76 : status === "needs_validation" ? 60 : 48,
        min_market_score: status === "ready" ? 58 : status === "needs_validation" ? 34 : 0,
        min_stable_patterns: status === "ready" ? 2 : 1,
        min_evidence_refs: status === "ready" ? 2 : 1,
        allowed_generation_modes: status === "ready"
          ? ["decision_ready"]
          : status === "needs_validation"
            ? ["control_ready", "brief_only"]
            : ["brief_only", "research_only"],
        blocked_reasons: blockers,
      };
      const readinessScore = clamp(
        num(item.trust_score) * 0.34
        + num(item.corpus_score) * 0.22
        + num(item.market_score) * 0.14
        + Math.min(14, num(item.stable_pattern_count) * 4)
        + Math.min(8, num(item.brief?.evidence_refs) * 4)
        + num(item.outcome_boost)
      );
      return {
        niche: text(item.niche),
        platform: text(item.platform),
        label: `${text(item.niche)} × ${text(item.platform)}`,
        decision_grade: text(item.decision_grade),
        generation_mode: text(item.generation_mode),
        readiness_score: readinessScore,
        ready_for_generation: Boolean(item.ready_for_generation),
        quality_gate: qualityGate,
        payload: {
          hook: text(item.generator_payload?.hook || item.brief?.hook),
          retention: text(item.generator_payload?.retention || item.brief?.retention),
          structure: text(item.generator_payload?.structure || item.action?.structure),
          second_by_second: list(item.brief?.second_by_second, 4),
          visual_recipe: list(item.generator_payload?.visual_recipe || item.brief?.visual_recipe, 4),
          audio_strategy: list(item.generator_payload?.audio_strategy || item.brief?.audio_strategy, 3),
          product_fit: list(item.generator_payload?.product_fit || item.brief?.product_fit, 3),
          copy_as_mechanic: list(item.generator_payload?.copy_as_mechanic || item.brief?.copy_as_mechanic, 3),
          do_not_copy: list(item.generator_payload?.do_not_copy || item.brief?.do_not_copy, 3),
        },
        brief_title: text(item.brief?.title),
        action_title: text(item.action?.title),
        action_decision: text(item.action?.decision),
        action_success_metric: text(item.action?.success_metric),
        action_guardrails: list(item.action?.guardrails, 4),
        hypothesis_title: text(item.hypothesis?.title),
        hypothesis_text: text(item.hypothesis?.text),
        hypothesis_success_metric: text(item.hypothesis?.success_metric),
        evidence_status: text(item.evidence_status),
        outcome_status: text(item.outcome_status, "no_feedback"),
        outcome_confidence: text(item.outcome_confidence, "none"),
        outcome_posts: num(item.outcome_posts),
        outcome_winners: num(item.outcome_winners),
        outcome_losers: num(item.outcome_losers),
        outcome_trust_action: text(item.outcome_trust_action),
        outcome_evidence: text(item.outcome_evidence),
        corpus_score: num(item.corpus_score),
        market_score: num(item.market_score),
        stable_pattern_count: num(item.stable_pattern_count),
        evidence_refs: num(item.brief?.evidence_refs),
        why_now: text(item.why_now),
        next_step: text(item.next_step),
      };
    })
    .sort((a, b) =>
      Number(b.ready_for_generation) - Number(a.ready_for_generation)
      || b.readiness_score - a.readiness_score
      || b.stable_pattern_count - a.stable_pattern_count
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  return {
    summary: {
      total: items.length,
      ready: items.filter((item) => item.quality_gate.status === "ready").length,
      needs_validation: items.filter((item) => item.quality_gate.status === "needs_validation").length,
      not_ready: items.filter((item) => item.quality_gate.status === "not_ready").length,
      decision_ready: items.filter((item) => item.generation_mode === "decision_ready").length,
      control_ready: items.filter((item) => item.generation_mode === "control_ready").length,
      avg_readiness_score: items.length ? Math.round(items.reduce((sum, item) => sum + item.readiness_score, 0) / items.length) : 0,
    },
    items: items.slice(0, Math.max(4, input.limit || 8)),
  };
}
