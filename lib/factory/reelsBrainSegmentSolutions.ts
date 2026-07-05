type JsonRecord = Record<string, unknown>;
import { buildReelsBrainSegmentStabilityAudit } from "./reelsBrainSegmentStabilityAudit";

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function list(value: unknown, limit = 5): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

function productionState(lane: string, evidenceBand: string) {
  if (lane === "ship" && evidenceBand === "stable") return "ready_now";
  if (lane === "validate" || evidenceBand === "forming") return "controlled_test";
  return "research_only";
}

export function buildReelsBrainSegmentSolutions(input: {
  decisionSnapshot?: {
    summary?: JsonRecord | null;
    ship_now?: JsonRecord[];
    validate_next?: JsonRecord[];
    research_queue?: JsonRecord[];
    items?: JsonRecord[];
  } | null;
  limit?: number;
}) {
  const stabilityAudit = buildReelsBrainSegmentStabilityAudit({
    decisionSnapshot: input.decisionSnapshot || null,
    limit: Math.max(20, input.limit || 12),
  });
  const stabilityMap = new Map(
    records(stabilityAudit.items).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const),
  );
  const rows = records(input.decisionSnapshot?.items)
    .map((row) => {
      const brief = (row.brief && typeof row.brief === "object" ? row.brief : {}) as JsonRecord;
      const hypothesis = (row.hypothesis && typeof row.hypothesis === "object" ? row.hypothesis : {}) as JsonRecord;
      const contentSolution = (row.content_solution && typeof row.content_solution === "object" ? row.content_solution : {}) as JsonRecord;
      const audit = (row.audit && typeof row.audit === "object" ? row.audit : {}) as JsonRecord;
      const lane = text(row.lane, "research");
      const readinessScore = num(row.readiness_score);
      const verdict = text(audit.verdict, lane);
      const stability = (stabilityMap.get(`${text(row.niche)}__${text(row.platform)}`) || {}) as JsonRecord;
      const evidenceBand = text(stability.evidence_band, "thin");
      const trust = evidenceBand === "stable" ? "high" : evidenceBand === "forming" ? "medium" : "low";
      const trustRow = (row.trust && typeof row.trust === "object" ? row.trust : {}) as JsonRecord;
      const outcomeStatus = text(trustRow.outcome_status, "no_feedback");
      const outcomePosts = num(trustRow.outcome_posts);
      const outcomeWinners = num(trustRow.outcome_winners);
      const outcomeLosers = num(trustRow.outcome_losers);
      const production = productionState(lane, evidenceBand);
      const trustWhy = [
        outcomeStatus === "proven" ? `рынок уже подтвердил сегмент: ${outcomeWinners}/${Math.max(outcomePosts, 1)} winner-posts` : "",
        outcomeStatus === "promising" ? `есть первые outcome-сигналы: ${outcomePosts} постов в обратной связи` : "",
        outcomeStatus === "weak" ? `обратная связь слабая: ${outcomeLosers}/${Math.max(outcomePosts, 1)} loser-posts` : "",
        ...list(stability.strengths, 4),
        ...list(stability.blockers, 3).map((item) => `blocker: ${item}`),
      ].slice(0, 5);

      return {
        niche: text(row.niche),
        platform: text(row.platform),
        label: text(row.label || `${row.niche} × ${row.platform}`),
        lane,
        verdict,
        readiness_score: readinessScore,
        trust_band: trust,
        production_state: production,
        ready_for_production: production === "ready_now",
        creative_brief: {
          title: text(brief.title, "Creative brief"),
          hook: text(brief.hook),
          retention: text(brief.retention),
          structure: text(brief.structure),
          second_by_second: list(brief.second_by_second, 5),
          visual_recipe: list(brief.visual_recipe, 5),
          audio_strategy: list(brief.audio_strategy, 4),
          product_fit: list(brief.product_fit, 4),
          copy_as_mechanic: list(brief.copy_as_mechanic, 4),
          do_not_copy: list(brief.do_not_copy, 4),
        },
        hypothesis: {
          title: text(hypothesis.title, "Hypothesis"),
          text: text(hypothesis.text),
          success_metric: text(hypothesis.success_metric),
        },
        content_decision: {
          title: text(contentSolution.action_title, "Content decision"),
          decision: text(contentSolution.action_decision, lane),
          success_metric: text(contentSolution.success_metric),
          guardrails: list(contentSolution.guardrails, 5),
          execution_note: text(contentSolution.execution_note),
          next_step: text(row.next_step),
        },
        trust_summary: {
          band: trust,
          score: readinessScore,
          evidence_band: evidenceBand,
          outcome_status: outcomeStatus,
          outcome_confidence: text(trustRow.outcome_confidence, "none"),
          outcome_posts: outcomePosts,
          outcome_winners: outcomeWinners,
          outcome_losers: outcomeLosers,
          outcome_trust_action: text(trustRow.outcome_trust_action),
          outcome_evidence: text(trustRow.outcome_evidence),
          stability_score: num(stability.stability_score),
          signals: list(stability.strengths, 4),
          blockers: list(stability.blockers, 4),
          current: (audit.current && typeof audit.current === "object" ? audit.current : null) as JsonRecord | null,
          targets: (audit.targets && typeof audit.targets === "object" ? audit.targets : null) as JsonRecord | null,
        },
        trust_why: trustWhy.length ? trustWhy : ["Нужен следующий цикл сигнала по сегменту."],
        stability_audit: stability,
      };
    })
    .filter((row) => row.niche && row.platform && (row.creative_brief.hook || row.hypothesis.text || row.content_decision.title))
    .sort((a, b) =>
      Number(b.ready_for_production) - Number(a.ready_for_production)
      || b.readiness_score - a.readiness_score
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  const limit = Math.max(4, input.limit || 12);
  const items = rows.slice(0, limit);

  return {
    summary: {
      snapshot: input.decisionSnapshot?.summary || null,
      total: rows.length,
      ready_now: rows.filter((row) => row.production_state === "ready_now").length,
      controlled_test: rows.filter((row) => row.production_state === "controlled_test").length,
      research_only: rows.filter((row) => row.production_state === "research_only").length,
      high_trust: rows.filter((row) => row.trust_band === "high").length,
      medium_trust: rows.filter((row) => row.trust_band === "medium").length,
      low_trust: rows.filter((row) => row.trust_band === "low").length,
    },
    ship_now: items.filter((row) => row.lane === "ship"),
    validate_next: items.filter((row) => row.lane === "validate"),
    research_queue: items.filter((row) => row.lane === "research"),
    items,
  };
}
