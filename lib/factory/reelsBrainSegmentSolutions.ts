type JsonRecord = Record<string, unknown>;

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

function trustBand(readinessScore: number, verdict: string) {
  if (readinessScore >= 85 && verdict === "ship") return "high";
  if (readinessScore >= 65 && (verdict === "ship" || verdict === "validate")) return "medium";
  return "low";
}

function productionState(lane: string, trust: string) {
  if (lane === "ship" && trust === "high") return "ready_now";
  if (lane === "validate" || trust === "medium") return "controlled_test";
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
  const rows = records(input.decisionSnapshot?.items)
    .map((row) => {
      const brief = (row.brief && typeof row.brief === "object" ? row.brief : {}) as JsonRecord;
      const hypothesis = (row.hypothesis && typeof row.hypothesis === "object" ? row.hypothesis : {}) as JsonRecord;
      const contentSolution = (row.content_solution && typeof row.content_solution === "object" ? row.content_solution : {}) as JsonRecord;
      const audit = (row.audit && typeof row.audit === "object" ? row.audit : {}) as JsonRecord;
      const lane = text(row.lane, "research");
      const readinessScore = num(row.readiness_score);
      const verdict = text(audit.verdict, lane);
      const trust = trustBand(readinessScore, verdict);
      const production = productionState(lane, trust);
      const trustWhy = [
        ...list(audit.strong_signals, 4),
        ...list(audit.blockers, 3).map((item) => `blocker: ${item}`),
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
          signals: list(audit.strong_signals, 4),
          blockers: list(audit.blockers, 4),
          current: (audit.current && typeof audit.current === "object" ? audit.current : null) as JsonRecord | null,
          targets: (audit.targets && typeof audit.targets === "object" ? audit.targets : null) as JsonRecord | null,
        },
        trust_why: trustWhy.length ? trustWhy : ["Нужен следующий цикл сигнала по сегменту."],
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
