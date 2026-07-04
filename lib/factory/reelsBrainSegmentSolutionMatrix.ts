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
  const trust = text(value, "low");
  if (trust === "high") return 3;
  if (trust === "medium") return 2;
  return 1;
}

function evidenceRank(value: unknown) {
  const band = text(value, "missing");
  if (band === "stable") return 4;
  if (band === "forming") return 3;
  if (band === "thin") return 2;
  if (band === "missing") return 1;
  return 0;
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
    || evidenceRank((b.trust_summary as JsonRecord | null)?.evidence_band) - evidenceRank((a.trust_summary as JsonRecord | null)?.evidence_band)
    || num((b.trust_summary as JsonRecord | null)?.stability_score) - num((a.trust_summary as JsonRecord | null)?.stability_score)
    || num(b.readiness_score) - num(a.readiness_score)
    || text(a.label).localeCompare(text(b.label));
}

function dedupeStrings(values: string[], limit = 5) {
  return Array.from(new Set(values.filter(Boolean))).slice(0, limit);
}

function summarizeGroup(groupKey: string, items: JsonRecord[], dimension: "niche" | "platform") {
  const sorted = [...items].sort(itemSort);
  const primary = sorted[0] || null;
  const otherDimension = dimension === "niche" ? "platform" : "niche";
  const coverage = dedupeStrings(sorted.map((row) => text(row[otherDimension])), 20);
  const blockers = dedupeStrings(
    sorted.flatMap((row) => list((row.trust_summary as JsonRecord | null)?.blockers, 10)),
    5,
  );
  const hooks = dedupeStrings(
    sorted.map((row) => text((row.creative_brief as JsonRecord | null)?.hook || row.hook)),
    4,
  );
  const readyNow = sorted.filter((row) => text(row.production_state) === "ready_now").length;
  const controlled = sorted.filter((row) => text(row.production_state) === "controlled_test").length;
  const research = sorted.filter((row) => text(row.production_state) === "research_only").length;
  const highTrust = sorted.filter((row) => text(row.trust_band) === "high").length;
  const avgReadiness = sorted.length ? Math.round(sorted.reduce((sum, row) => sum + num(row.readiness_score), 0) / sorted.length) : 0;
  const avgStability = sorted.length
    ? Math.round(sorted.reduce((sum, row) => sum + num((row.trust_summary as JsonRecord | null)?.stability_score), 0) / sorted.length)
    : 0;
  const nextGap = [...sorted]
    .sort((a, b) =>
      productionRank(a.production_state) - productionRank(b.production_state)
      || trustRank(a.trust_band) - trustRank(b.trust_band)
      || num(a.readiness_score) - num(b.readiness_score)
      || text(a.label).localeCompare(text(b.label)),
    )[0] || null;

  return {
    [dimension]: groupKey,
    label: groupKey,
    trust_band: primary ? text(primary.trust_band, "low") : "low",
    evidence_band: primary ? text((primary.trust_summary as JsonRecord | null)?.evidence_band, "missing") : "missing",
    avg_readiness_score: avgReadiness,
    avg_stability_score: avgStability,
    ready_now: readyNow,
    controlled_test: controlled,
    research_only: research,
    high_trust: highTrust,
    total_segments: sorted.length,
    coverage_labels: coverage,
    primary,
    top_hooks: hooks,
    blockers,
    next_gap: nextGap ? {
      label: text(nextGap.label),
      [otherDimension]: text(nextGap[otherDimension]),
      production_state: text(nextGap.production_state),
      trust_band: text(nextGap.trust_band),
      evidence_band: text((nextGap.trust_summary as JsonRecord | null)?.evidence_band, "missing"),
      blockers: list((nextGap.trust_summary as JsonRecord | null)?.blockers, 3),
      next_step: text((nextGap.content_decision as JsonRecord | null)?.next_step || nextGap.next_step),
    } : null,
  };
}

export function buildReelsBrainSegmentSolutionMatrix(input: {
  segmentSolutions?: {
    items?: JsonRecord[];
    summary?: JsonRecord | null;
  } | null;
  niches?: string[];
  platforms?: string[];
  limit?: number;
}) {
  const items = records(input.segmentSolutions?.items)
    .filter((row) => text(row.niche) && text(row.platform))
    .sort(itemSort);
  const niches = Array.from(new Set((input.niches || items.map((row) => text(row.niche))).map((row) => text(row)).filter(Boolean))).sort();
  const platforms = Array.from(new Set((input.platforms || items.map((row) => text(row.platform))).map((row) => text(row)).filter(Boolean))).sort();
  const byNiche = niches
    .map((niche) => summarizeGroup(niche, items.filter((row) => text(row.niche) === niche), "niche"))
    .filter((row) => row.total_segments > 0)
    .sort((a, b) =>
      productionRank((b.primary as JsonRecord | null)?.production_state) - productionRank((a.primary as JsonRecord | null)?.production_state)
      || trustRank((b.primary as JsonRecord | null)?.trust_band) - trustRank((a.primary as JsonRecord | null)?.trust_band)
      || b.avg_readiness_score - a.avg_readiness_score
      || text(a.niche).localeCompare(text(b.niche)),
    );
  const byPlatform = platforms
    .map((platform) => summarizeGroup(platform, items.filter((row) => text(row.platform) === platform), "platform"))
    .filter((row) => row.total_segments > 0)
    .sort((a, b) =>
      productionRank((b.primary as JsonRecord | null)?.production_state) - productionRank((a.primary as JsonRecord | null)?.production_state)
      || trustRank((b.primary as JsonRecord | null)?.trust_band) - trustRank((a.primary as JsonRecord | null)?.trust_band)
      || b.avg_readiness_score - a.avg_readiness_score
      || text(a.platform).localeCompare(text(b.platform)),
    );

  return {
    summary: {
      total_segments: items.length,
      ready_now: items.filter((row) => text(row.production_state) === "ready_now").length,
      controlled_test: items.filter((row) => text(row.production_state) === "controlled_test").length,
      research_only: items.filter((row) => text(row.production_state) === "research_only").length,
      high_trust_segments: items.filter((row) => text(row.trust_band) === "high").length,
      niches: byNiche.length,
      platforms: byPlatform.length,
      source_summary: input.segmentSolutions?.summary || null,
    },
    by_segment: items.slice(0, Math.max(6, input.limit || 12)),
    by_niche: byNiche.slice(0, Math.max(3, input.limit || 12)),
    by_platform: byPlatform.slice(0, Math.max(3, input.limit || 12)),
  };
}
