import { buildReelsBrainOutcomeGuardrails } from "./reelsBrainOutcomeGuardrails";

type GenerationPackRow = {
  niche?: string;
  platform?: string;
  label?: string;
  decision_grade?: string;
  generation_mode?: string;
  ready_for_generation?: boolean;
  readiness_score?: number;
  quality_gate?: {
    status?: "ready" | "needs_validation" | "not_ready" | string;
    allowed_generation_modes?: string[];
    blocked_reasons?: string[];
  };
  payload?: {
    hook?: string;
    retention?: string;
    structure?: string;
    second_by_second?: string[];
    visual_recipe?: string[];
    audio_strategy?: string[];
    product_fit?: string[];
    copy_as_mechanic?: string[];
    do_not_copy?: string[];
  };
  brief_title?: string;
  action_title?: string;
  action_decision?: string;
  action_success_metric?: string;
  action_guardrails?: string[];
  hypothesis_title?: string;
  hypothesis_text?: string;
  hypothesis_success_metric?: string;
  why_now?: string;
  next_step?: string;
  evidence_status?: string;
  outcome_status?: string;
  proof_quality?: string;
  outcome_exact_segment_posts?: number;
  outcome_traced_posts?: number;
  outcome_confidence?: string;
  outcome_posts?: number;
  outcome_winners?: number;
  outcome_losers?: number;
  outcome_trust_action?: string;
  outcome_evidence?: string;
  corpus_score?: number;
  market_score?: number;
  stable_pattern_count?: number;
  evidence_refs?: number;
  segment_priority_score?: number;
  segment_priority_mode?: string;
  segment_ready_for_generation?: boolean;
  projected_trust_gain_score?: number;
  projected_production_state?: string;
  unlocked_output?: string;
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

function uniq(value: string[], limit = 6) {
  return Array.from(new Set(value.map((item) => text(item)).filter(Boolean))).slice(0, limit);
}

function exportLane(value: string) {
  if (value === "ready") return "ship";
  if (value === "needs_validation") return "validate";
  return "research";
}

function policyModeScore(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "primary") return 3;
  if (raw === "control_only") return 2;
  return 1;
}

export function buildReelsBrainSegmentCreativeExports(input: {
  segmentGenerationPacks?: {
    items?: GenerationPackRow[];
  };
  limit?: number;
}) {
  const rows = (input.segmentGenerationPacks?.items || [])
    .map((row) => {
      const lane = exportLane(text(row.quality_gate?.status));
      const outcomeGuardrails = buildReelsBrainOutcomeGuardrails({
        outcome_status: row.outcome_status,
        outcome_confidence: row.outcome_confidence,
        outcome_posts: row.outcome_posts,
        outcome_winners: row.outcome_winners,
        outcome_losers: row.outcome_losers,
        outcome_trust_action: row.outcome_trust_action,
        outcome_evidence: row.outcome_evidence,
        platform: row.platform,
      });
      return {
        niche: text(row.niche),
        platform: text(row.platform),
        label: text(row.label || `${row.niche} × ${row.platform}`),
        lane,
        segment_priority_score: num(row.segment_priority_score),
        segment_priority_mode: text(row.segment_priority_mode, "research_only"),
        segment_ready_for_generation: Boolean(row.segment_ready_for_generation),
        projected_trust_gain_score: num(row.projected_trust_gain_score),
        projected_production_state: text(row.projected_production_state),
        unlocked_output: text(row.unlocked_output),
        readiness_score: num(row.readiness_score),
        ready_for_generation: Boolean(row.ready_for_generation),
        brief: {
          title: text(row.brief_title, "Creative brief"),
          hook: text(row.payload?.hook),
          retention: text(row.payload?.retention),
          structure: text(row.payload?.structure),
          second_by_second: list(row.payload?.second_by_second, 4),
          visual_recipe: list(row.payload?.visual_recipe, 4),
          audio_strategy: list(row.payload?.audio_strategy, 3),
          product_fit: list(row.payload?.product_fit, 3),
          copy_as_mechanic: list(row.payload?.copy_as_mechanic, 3),
          do_not_copy: uniq([
            ...list(row.payload?.do_not_copy, 3),
            ...outcomeGuardrails.do_not_copy,
          ], 5),
        },
        hypothesis: {
          title: text(row.hypothesis_title, "Hypothesis"),
          text: text(row.hypothesis_text),
          success_metric: text(row.hypothesis_success_metric || row.action_success_metric),
        },
        content_solution: {
          action_title: text(row.action_title, "Content action"),
          action_decision: text(row.action_decision),
          success_metric: text(row.action_success_metric || row.hypothesis_success_metric),
          guardrails: uniq([
            ...list(row.action_guardrails, 4),
            ...outcomeGuardrails.guardrails,
          ], 6),
          execution_note: lane === "ship"
            ? text(row.proof_quality) === "exact_segment"
              ? "Можно идти в основной generation lane."
              : "Ship lane формально достигнут, но без exact-proof лучше запускать только как ограниченный rollout."
            : lane === "validate"
              ? "Запускать только как control-ready тест."
              : "Пока только исследовательский сегмент без продового запуска.",
        },
        trust: {
          evidence_status: text(row.evidence_status),
          outcome_status: text(row.outcome_status, "no_feedback"),
          proof_quality: text(row.proof_quality, "untraced"),
          exact_segment_ready: text(row.proof_quality) === "exact_segment" && lane === "ship",
          outcome_exact_segment_posts: num(row.outcome_exact_segment_posts),
          outcome_traced_posts: num(row.outcome_traced_posts),
          outcome_confidence: text(row.outcome_confidence, "none"),
          outcome_posts: num(row.outcome_posts),
          outcome_winners: num(row.outcome_winners),
          outcome_losers: num(row.outcome_losers),
          outcome_trust_action: text(row.outcome_trust_action),
          outcome_evidence: text(row.outcome_evidence),
          outcome_anti_patterns: outcomeGuardrails.anti_patterns,
          corpus_score: num(row.corpus_score),
          market_score: num(row.market_score),
          stable_pattern_count: num(row.stable_pattern_count),
          evidence_refs: num(row.evidence_refs),
        },
        generator_bundle: {
          lane,
          exact_segment_ready: text(row.proof_quality) === "exact_segment" && lane === "ship",
          allowed_modes: list(row.quality_gate?.allowed_generation_modes, 4),
          blocked_reasons: list(row.quality_gate?.blocked_reasons, 5),
          payload: {
            hook: text(row.payload?.hook),
            retention: text(row.payload?.retention),
            structure: text(row.payload?.structure),
            visual_recipe: list(row.payload?.visual_recipe, 4),
            audio_strategy: list(row.payload?.audio_strategy, 3),
            product_fit: list(row.payload?.product_fit, 3),
            copy_as_mechanic: list(row.payload?.copy_as_mechanic, 3),
            do_not_copy: uniq([
              ...list(row.payload?.do_not_copy, 3),
              ...outcomeGuardrails.do_not_copy,
            ], 5),
          },
          outcome_guardrails: outcomeGuardrails.guardrails,
          outcome_anti_patterns: outcomeGuardrails.anti_patterns,
        },
        why_now: text(row.why_now),
        next_step: text(row.next_step),
        publishable_exact: text(row.proof_quality) === "exact_segment" && lane === "ship",
      };
    })
    .sort((a, b) =>
      policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
      || b.segment_priority_score - a.segment_priority_score
      || Number(b.ready_for_generation) - Number(a.ready_for_generation)
      || b.readiness_score - a.readiness_score
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  return {
    summary: {
      total: rows.length,
      ship: rows.filter((row) => row.lane === "ship").length,
      validate: rows.filter((row) => row.lane === "validate").length,
      research: rows.filter((row) => row.lane === "research").length,
      primary_priority_segments: rows.filter((row) => row.segment_priority_mode === "primary").length,
    },
    ship_now: rows.filter((row) => row.lane === "ship").slice(0, Math.max(2, Math.min(6, input.limit || 8))),
    validate_next: rows.filter((row) => row.lane === "validate").slice(0, Math.max(2, Math.min(6, input.limit || 8))),
    research_queue: rows.filter((row) => row.lane === "research").slice(0, Math.max(2, Math.min(6, input.limit || 8))),
    items: rows.slice(0, Math.max(4, input.limit || 8)),
  };
}
