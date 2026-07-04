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

export function buildReelsBrainPortfolioReadiness(input: {
  segmentStabilityAudit?: {
    items?: JsonRecord[];
  } | null;
  niches?: string[];
  platforms?: string[];
}) {
  const niches = Array.from(new Set((input.niches || []).map((row) => text(row)).filter(Boolean))).sort();
  const platforms = Array.from(new Set((input.platforms || []).map((row) => text(row)).filter(Boolean))).sort();
  const rows = records(input.segmentStabilityAudit?.items);
  const expectedTotal = niches.length * platforms.length;
  const rowMap = new Map(rows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const));

  const bySegment = niches.flatMap((niche) =>
    platforms.map((platform) => {
      const row = (rowMap.get(`${niche}__${platform}`) || {}) as JsonRecord;
      const band = text(row.evidence_band, "missing");
      const stability = num(row.stability_score);
      return {
        niche,
        platform,
        label: `${niche} × ${platform}`,
        evidence_band: band,
        stability_score: stability,
        high_trust_segment: Boolean(row.high_trust_segment),
        missing: !rowMap.has(`${niche}__${platform}`),
        blockers: Array.isArray(row.blockers) ? row.blockers.slice(0, 3) : [],
      };
    }),
  );

  const byNiche = niches.map((niche) => {
    const items = bySegment.filter((row) => row.niche === niche);
    const stable = items.filter((row) => row.evidence_band === "stable").length;
    const forming = items.filter((row) => row.evidence_band === "forming").length;
    const thin = items.filter((row) => row.evidence_band === "thin").length;
    const missing = items.filter((row) => row.missing).length;
    return {
      niche,
      stable,
      forming,
      thin,
      missing,
      coverage_pct: pct(stable + forming + thin, items.length),
      high_trust_pct: pct(stable, items.length),
      readiness: stable === items.length ? "covered" : stable > 0 || forming > 0 ? "partial" : "weak",
      next_gap: items.find((row) => row.evidence_band !== "stable")?.platform || null,
    };
  }).sort((a, b) =>
    b.high_trust_pct - a.high_trust_pct
    || b.coverage_pct - a.coverage_pct
    || a.niche.localeCompare(b.niche),
  );

  const byPlatform = platforms.map((platform) => {
    const items = bySegment.filter((row) => row.platform === platform);
    const stable = items.filter((row) => row.evidence_band === "stable").length;
    const forming = items.filter((row) => row.evidence_band === "forming").length;
    const thin = items.filter((row) => row.evidence_band === "thin").length;
    const missing = items.filter((row) => row.missing).length;
    return {
      platform,
      stable,
      forming,
      thin,
      missing,
      coverage_pct: pct(stable + forming + thin, items.length),
      high_trust_pct: pct(stable, items.length),
      readiness: stable === items.length ? "covered" : stable > 0 || forming > 0 ? "partial" : "weak",
      next_gap: items.find((row) => row.evidence_band !== "stable")?.niche || null,
    };
  }).sort((a, b) =>
    b.high_trust_pct - a.high_trust_pct
    || b.coverage_pct - a.coverage_pct
    || a.platform.localeCompare(b.platform),
  );

  const stable = bySegment.filter((row) => row.evidence_band === "stable").length;
  const forming = bySegment.filter((row) => row.evidence_band === "forming").length;
  const thin = bySegment.filter((row) => row.evidence_band === "thin").length;
  const missing = bySegment.filter((row) => row.missing).length;
  const coverageKnown = stable + forming + thin;
  const verdict = stable === expectedTotal && expectedTotal > 0
    ? "ready_for_high_trust_generation"
    : stable >= Math.ceil(expectedTotal * 0.6) && forming + stable >= Math.ceil(expectedTotal * 0.85)
      ? "mostly_ready_but_fill_gaps"
      : "still_building";

  return {
    summary: {
      niches: niches.length,
      platforms: platforms.length,
      expected_segments: expectedTotal,
      stable_segments: stable,
      forming_segments: forming,
      thin_segments: thin,
      missing_segments: missing,
      covered_segments: coverageKnown,
      high_trust_coverage_pct: pct(stable, expectedTotal),
      known_coverage_pct: pct(coverageKnown, expectedTotal),
      verdict,
    },
    by_niche: byNiche,
    by_platform: byPlatform,
    missing_segments: bySegment.filter((row) => row.missing || row.evidence_band !== "stable").slice(0, 12),
    strongest_segments: bySegment
      .filter((row) => row.evidence_band === "stable")
      .sort((a, b) => b.stability_score - a.stability_score || a.label.localeCompare(b.label))
      .slice(0, 12),
  };
}
