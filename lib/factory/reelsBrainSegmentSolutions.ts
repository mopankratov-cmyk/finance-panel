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

function policyModeScore(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "primary") return 3;
  if (raw === "control_only") return 2;
  return 1;
}

function upgradeForecast(row: JsonRecord | null | undefined) {
  if (!row) return null;
  return {
    unlocked_output: text(row.unlocked_output),
    projected_production_state: text(row.projected_production_state),
    projected_trust_gain_score: num(row.projected_trust_gain_score),
    projected_trust_gain_band: text(row.projected_trust_gain_band),
    recommended_loop: text(row.recommended_loop),
    unlocked_next_step: text(row.unlocked_next_step),
  };
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
      const proofQuality = text(trustRow.proof_quality, "untraced");
      const outcomePosts = num(trustRow.outcome_posts);
      const outcomeWinners = num(trustRow.outcome_winners);
      const outcomeLosers = num(trustRow.outcome_losers);
      const highTrustGenerationReady = Boolean(row.high_trust_generation_ready);
      const publishableExact = Boolean(row.publishable_exact || highTrustGenerationReady);
      const recommendedUpgrade = upgradeForecast((row.upgrade_forecast && typeof row.upgrade_forecast === "object"
        ? row.upgrade_forecast
        : null) as JsonRecord | null);
      const production = highTrustGenerationReady
        ? "ready_now"
        : proofQuality === "exact_segment"
        ? productionState(lane, evidenceBand)
        : lane === "ship" || lane === "validate" || evidenceBand === "forming"
          ? "controlled_test"
          : "research_only";
      const trustWhy = [
        highTrustGenerationReady ? "generation-ready слой уже считает сегмент high-trust и production-usable." : "",
        publishableExact && !highTrustGenerationReady ? "publishable exact уже закрыт, но high-trust generation-ready слой ещё не добран полностью." : "",
        proofQuality === "exact_segment" ? "exact-proof уже закрыт для этого niche × platform" : "",
        proofQuality === "traced_transfer_only" ? "есть только transfer-level proof, поэтому продовый rollout ещё рано" : "",
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
        segment_priority_score: num(row.segment_priority_score),
        segment_priority_mode: text(row.segment_priority_mode, "research_only"),
        segment_ready_for_generation: Boolean(row.segment_ready_for_generation),
        projected_trust_gain_score: num(row.projected_trust_gain_score),
        projected_production_state: text(row.projected_production_state),
        unlocked_output: text(row.unlocked_output),
        verdict,
        readiness_score: readinessScore,
        high_trust_generation_ready: highTrustGenerationReady,
        publishable_exact: publishableExact,
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
          recommended_upgrade: recommendedUpgrade,
        },
        trust_summary: {
          band: trust,
          score: readinessScore,
          evidence_band: evidenceBand,
          proof_quality: proofQuality,
          outcome_status: outcomeStatus,
          outcome_confidence: text(trustRow.outcome_confidence, "none"),
          outcome_posts: outcomePosts,
          outcome_winners: outcomeWinners,
          outcome_losers: outcomeLosers,
          outcome_trust_action: text(trustRow.outcome_trust_action),
          outcome_evidence: text(trustRow.outcome_evidence),
          stability_score: num(stability.stability_score),
          high_trust_generation_ready: highTrustGenerationReady,
          publishable_exact: publishableExact,
          signals: list(stability.strengths, 4),
          blockers: list(stability.blockers, 4),
          current: (audit.current && typeof audit.current === "object" ? audit.current : null) as JsonRecord | null,
          targets: (audit.targets && typeof audit.targets === "object" ? audit.targets : null) as JsonRecord | null,
        },
        trust_why: trustWhy.length ? trustWhy : ["Нужен следующий цикл сигнала по сегменту."],
        recommended_upgrade: recommendedUpgrade,
        stability_audit: stability,
      };
    })
    .filter((row) => row.niche && row.platform && (row.creative_brief.hook || row.hypothesis.text || row.content_decision.title))
    .sort((a, b) =>
      policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
      || b.segment_priority_score - a.segment_priority_score
      || Number(b.high_trust_generation_ready) - Number(a.high_trust_generation_ready)
      || Number(b.ready_for_production) - Number(a.ready_for_production)
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
      generation_ready: rows.filter((row) => row.high_trust_generation_ready).length,
      publishable_exact: rows.filter((row) => row.publishable_exact).length,
      primary_priority_segments: rows.filter((row) => row.segment_priority_mode === "primary").length,
    },
    ship_now: items.filter((row) => row.lane === "ship"),
    validate_next: items.filter((row) => row.lane === "validate"),
    research_queue: items.filter((row) => row.lane === "research"),
    items,
  };
}
