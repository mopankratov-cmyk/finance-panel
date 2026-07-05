type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

function pct(current: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function evidenceRank(value: unknown) {
  const band = text(value, "missing");
  if (band === "stable") return 4;
  if (band === "forming") return 3;
  if (band === "thin") return 2;
  if (band === "missing") return 1;
  return 0;
}

function policyModeRank(value: unknown) {
  const mode = text(value, "research_only");
  if (mode === "primary") return 3;
  if (mode === "control_only") return 2;
  return 1;
}

export function buildReelsBrainPortfolioReadiness(input: {
  segmentStabilityAudit?: {
    items?: JsonRecord[];
  } | null;
  segmentSolutionMatrix?: {
    by_segment?: JsonRecord[];
  } | null;
  niches?: string[];
  platforms?: string[];
  segmentPriorityQueue?: {
    items?: JsonRecord[];
  } | null;
}) {
  const niches = Array.from(new Set((input.niches || []).map((row) => text(row)).filter(Boolean))).sort();
  const platforms = Array.from(new Set((input.platforms || []).map((row) => text(row)).filter(Boolean))).sort();
  const rows = records(input.segmentStabilityAudit?.items);
  const solutionRows = records(input.segmentSolutionMatrix?.by_segment);
  const expectedTotal = niches.length * platforms.length;
  const rowMap = new Map(rows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));
  const solutionMap = new Map(solutionRows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));
  const priorityMap = new Map(records(input.segmentPriorityQueue?.items).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));

  const bySegment = niches.flatMap((niche) =>
    platforms.map((platform) => {
      const row = (rowMap.get(`${niche}__${platform}`) || {}) as JsonRecord;
      const solution = (solutionMap.get(`${niche}__${platform}`) || {}) as JsonRecord;
      const priority = (priorityMap.get(`${niche}__${platform}`) || {}) as JsonRecord;
      const band = text(row.evidence_band, "missing");
      const stability = num(row.stability_score);
      const publishableExact = Boolean(solution.publishable_exact);
      return {
        niche,
        platform,
        label: `${niche} × ${platform}`,
        segment_priority_score: num(priority.decision_priority_score || priority.urgency_score),
        segment_priority_mode: text(priority.policy_mode, "research_only"),
        segment_ready_for_generation: Boolean(priority.ready_for_generation),
        evidence_band: band,
        stability_score: stability,
        high_trust_segment: Boolean(row.high_trust_segment),
        publishable_exact: publishableExact,
        outcome_status: text(row.outcome_status, "no_feedback"),
        missing: !rowMap.has(`${niche}__${platform}`),
        exact_gap: !publishableExact,
        blockers: Array.isArray(row.blockers) ? row.blockers.slice(0, 3) : [],
      };
    }),
  );

  const byNiche = niches.map((niche) => {
    const items = bySegment.filter((row) => row.niche === niche);
    const stable = items.filter((row) => row.evidence_band === "stable").length;
    const highTrust = items.filter((row) => row.high_trust_segment).length;
    const forming = items.filter((row) => row.evidence_band === "forming").length;
    const thin = items.filter((row) => row.evidence_band === "thin").length;
    const missing = items.filter((row) => row.missing).length;
    const publishableExact = items.filter((row) => row.publishable_exact).length;
    const weakOutcome = items.filter((row) => row.outcome_status === "weak").length;
    return {
      niche,
      stable,
      high_trust: highTrust,
      forming,
      thin,
      missing,
      publishable_exact: publishableExact,
      coverage_pct: pct(stable + forming + thin, items.length),
      high_trust_pct: pct(highTrust, items.length),
      publishable_exact_pct: pct(publishableExact, items.length),
      weak_outcome_segments: weakOutcome,
      primary_priority_segments: items.filter((row) => row.segment_priority_mode === "primary").length,
      readiness: publishableExact === items.length
        ? "publishable_exact"
        : highTrust === items.length
          ? "covered"
          : highTrust > 0 || forming > 0 || stable > 0
            ? "partial"
            : "weak",
      next_gap: items.find((row) => !row.high_trust_segment)?.platform || null,
    };
  }).sort((a, b) =>
    b.primary_priority_segments - a.primary_priority_segments
    || b.publishable_exact_pct - a.publishable_exact_pct
    || b.high_trust_pct - a.high_trust_pct
    || b.coverage_pct - a.coverage_pct
    || a.niche.localeCompare(b.niche),
  );

  const byPlatform = platforms.map((platform) => {
    const items = bySegment.filter((row) => row.platform === platform);
    const stable = items.filter((row) => row.evidence_band === "stable").length;
    const highTrust = items.filter((row) => row.high_trust_segment).length;
    const forming = items.filter((row) => row.evidence_band === "forming").length;
    const thin = items.filter((row) => row.evidence_band === "thin").length;
    const missing = items.filter((row) => row.missing).length;
    const publishableExact = items.filter((row) => row.publishable_exact).length;
    const weakOutcome = items.filter((row) => row.outcome_status === "weak").length;
    return {
      platform,
      stable,
      high_trust: highTrust,
      forming,
      thin,
      missing,
      publishable_exact: publishableExact,
      coverage_pct: pct(stable + forming + thin, items.length),
      high_trust_pct: pct(highTrust, items.length),
      publishable_exact_pct: pct(publishableExact, items.length),
      weak_outcome_segments: weakOutcome,
      primary_priority_segments: items.filter((row) => row.segment_priority_mode === "primary").length,
      readiness: publishableExact === items.length
        ? "publishable_exact"
        : highTrust === items.length
          ? "covered"
          : highTrust > 0 || forming > 0 || stable > 0
            ? "partial"
            : "weak",
      next_gap: items.find((row) => !row.high_trust_segment)?.niche || null,
    };
  }).sort((a, b) =>
    b.primary_priority_segments - a.primary_priority_segments
    || b.publishable_exact_pct - a.publishable_exact_pct
    || b.high_trust_pct - a.high_trust_pct
    || b.coverage_pct - a.coverage_pct
    || a.platform.localeCompare(b.platform),
  );

  const stable = bySegment.filter((row) => row.evidence_band === "stable").length;
  const highTrust = bySegment.filter((row) => row.high_trust_segment).length;
  const forming = bySegment.filter((row) => row.evidence_band === "forming").length;
  const thin = bySegment.filter((row) => row.evidence_band === "thin").length;
  const missing = bySegment.filter((row) => row.missing).length;
  const publishableExact = bySegment.filter((row) => row.publishable_exact).length;
  const weakOutcome = bySegment.filter((row) => row.outcome_status === "weak").length;
  const coverageKnown = stable + forming + thin;
  const verdict = publishableExact === expectedTotal && expectedTotal > 0
    ? "ready_for_publishable_exact_generation"
    : highTrust === expectedTotal && publishableExact < expectedTotal
      ? "high_trust_but_exact_gaps"
    : highTrust === expectedTotal && expectedTotal > 0
      ? "ready_for_high_trust_generation"
    : highTrust >= Math.ceil(expectedTotal * 0.6) && publishableExact >= Math.ceil(expectedTotal * 0.35)
      ? "high_trust_but_exact_gaps"
    : highTrust >= Math.ceil(expectedTotal * 0.6) && forming + stable >= Math.ceil(expectedTotal * 0.85)
      ? "mostly_ready_but_fill_gaps"
      : "still_building";

  return {
    summary: {
      niches: niches.length,
      platforms: platforms.length,
      expected_segments: expectedTotal,
      stable_segments: stable,
      market_confirmed_segments: highTrust,
      forming_segments: forming,
      thin_segments: thin,
      missing_segments: missing,
      weak_outcome_segments: weakOutcome,
      covered_segments: coverageKnown,
      high_trust_coverage_pct: pct(highTrust, expectedTotal),
      publishable_exact_segments: publishableExact,
      publishable_exact_coverage_pct: pct(publishableExact, expectedTotal),
      known_coverage_pct: pct(coverageKnown, expectedTotal),
      verdict,
    },
    by_niche: byNiche,
    by_platform: byPlatform,
    missing_segments: bySegment.filter((row) => row.missing || !row.high_trust_segment).slice(0, 12),
    publishable_exact_gaps: bySegment
      .filter((row) => !row.publishable_exact)
      .sort((a, b) =>
        policyModeRank(b.segment_priority_mode) - policyModeRank(a.segment_priority_mode)
        || b.segment_priority_score - a.segment_priority_score
        || Number(Boolean(b.high_trust_segment)) - Number(Boolean(a.high_trust_segment))
        || evidenceRank(b.evidence_band) - evidenceRank(a.evidence_band)
        || b.stability_score - a.stability_score
        || Number(Boolean(a.missing)) - Number(Boolean(b.missing))
        || a.label.localeCompare(b.label),
      )
      .slice(0, 12),
    strongest_segments: bySegment
      .filter((row) => row.high_trust_segment)
      .sort((a, b) => b.stability_score - a.stability_score || a.label.localeCompare(b.label))
      .slice(0, 12),
  };
}
