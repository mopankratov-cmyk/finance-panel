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

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function truthyTextCount(values: unknown[]) {
  return values.reduce<number>((sum, value) => sum + (text(value) ? 1 : 0), 0);
}

function completenessScore(row: JsonRecord) {
  const brief = (row.brief && typeof row.brief === "object" ? row.brief : {}) as JsonRecord;
  const hypothesis = (row.hypothesis && typeof row.hypothesis === "object" ? row.hypothesis : {}) as JsonRecord;
  const content = (row.content_solution && typeof row.content_solution === "object" ? row.content_solution : {}) as JsonRecord;
  const total = truthyTextCount([
    brief.title,
    brief.hook,
    brief.retention,
    brief.structure,
    hypothesis.title,
    hypothesis.text,
    hypothesis.success_metric,
    content.action_title,
    content.action_decision,
    content.success_metric,
  ]);
  return clamp((Number(total) / 10) * 100);
}

function evidenceBand(input: {
  stabilityScore: number;
  blockers: string[];
}) {
  if (input.stabilityScore >= 82 && input.blockers.length === 0) return "stable";
  if (input.stabilityScore >= 60) return "forming";
  return "thin";
}

export function buildReelsBrainSegmentStabilityAudit(input: {
  decisionSnapshot?: {
    summary?: JsonRecord | null;
    items?: JsonRecord[];
  } | null;
  limit?: number;
}) {
  const items = records(input.decisionSnapshot?.items)
    .map((row) => {
      const trust = (row.trust && typeof row.trust === "object" ? row.trust : {}) as JsonRecord;
      const audit = (row.audit && typeof row.audit === "object" ? row.audit : {}) as JsonRecord;
      const readinessScore = num(row.readiness_score);
      const corpusScore = num(trust.corpus_score);
      const marketScore = num(trust.market_score);
      const stablePatterns = num(trust.stable_pattern_count);
      const evidenceRefs = num(trust.evidence_refs);
      const outcomeStatus = text(trust.outcome_status, "no_feedback");
      const outcomeConfidence = text(trust.outcome_confidence, "none");
      const completeness = completenessScore(row);
      const blockers = [
        readinessScore < 85 ? "trust floor below 85" : "",
        corpusScore < 75 ? "corpus score below 75" : "",
        marketScore < 55 ? "market score below 55" : "",
        stablePatterns < 3 ? "fewer than 3 stable patterns" : "",
        evidenceRefs < 3 ? "fewer than 3 evidence references" : "",
        outcomeStatus === "weak" ? "market outcome remains weak" : "",
        completeness < 70 ? "brief/hypothesis/content decision still incomplete" : "",
      ].filter(Boolean);
      const strengths = [
        readinessScore >= 85 ? "readiness clears high-trust floor" : "",
        corpusScore >= 75 ? "corpus density is strong enough" : "",
        marketScore >= 55 ? "market evidence is usable" : "",
        stablePatterns >= 3 ? "segment has enough stable patterns" : "",
        evidenceRefs >= 3 ? "enough evidence references accumulated" : "",
        outcomeStatus === "proven" ? "market outcome already confirmed by winners" : "",
        outcomeStatus === "promising" ? "market outcome is forming with early wins" : "",
        text(audit.verdict) === "ship" ? "readiness audit already says ship" : "",
        completeness >= 70 ? "operator outputs are complete enough for downstream use" : "",
      ].filter(Boolean);
      const score = clamp(
        readinessScore * 0.28
        + corpusScore * 0.2
        + marketScore * 0.16
        + Math.min(18, stablePatterns * 6)
        + Math.min(12, evidenceRefs * 4)
        + completeness * 0.14,
      );
      const band = evidenceBand({ stabilityScore: score, blockers });
      return {
        niche: text(row.niche),
        platform: text(row.platform),
        label: text(row.label || `${row.niche} × ${row.platform}`),
        lane: text(row.lane, "research"),
        verdict: text(audit.verdict || row.lane, "research"),
        stability_score: score,
        evidence_band: band,
        outcome_status: outcomeStatus,
        outcome_confidence: outcomeConfidence,
        readiness_score: readinessScore,
        corpus_score: corpusScore,
        market_score: marketScore,
        stable_pattern_count: stablePatterns,
        evidence_refs: evidenceRefs,
        completeness_score: completeness,
        can_generate_brief: completeness >= 35 && Boolean(text((row.brief as JsonRecord | undefined)?.hook)),
        can_generate_hypothesis: Boolean(text((row.hypothesis as JsonRecord | undefined)?.text)),
        can_generate_content_decision: Boolean(text((row.content_solution as JsonRecord | undefined)?.action_title)),
        high_trust_segment: band === "stable" && outcomeStatus !== "weak",
        strengths: strengths.slice(0, 5),
        blockers: blockers.slice(0, 6),
      };
    })
    .filter((row) => row.niche && row.platform)
    .sort((a, b) =>
      Number(b.high_trust_segment) - Number(a.high_trust_segment)
      || b.stability_score - a.stability_score
      || b.stable_pattern_count - a.stable_pattern_count
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  const limit = Math.max(4, input.limit || 12);
  return {
    summary: {
      snapshot: input.decisionSnapshot?.summary || null,
      total: items.length,
      stable: items.filter((row) => row.evidence_band === "stable").length,
      forming: items.filter((row) => row.evidence_band === "forming").length,
      thin: items.filter((row) => row.evidence_band === "thin").length,
      high_trust_segments: items.filter((row) => row.high_trust_segment).length,
      brief_ready: items.filter((row) => row.can_generate_brief).length,
      hypothesis_ready: items.filter((row) => row.can_generate_hypothesis).length,
      decision_ready: items.filter((row) => row.can_generate_content_decision).length,
    },
    stable_now: items.filter((row) => row.evidence_band === "stable").slice(0, limit),
    forming_next: items.filter((row) => row.evidence_band === "forming").slice(0, limit),
    thin_segments: items.filter((row) => row.evidence_band === "thin").slice(0, limit),
    items: items.slice(0, limit),
  };
}
