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

function list(value: unknown, limit = 5): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function uniq(value: string[], limit = 6) {
  return Array.from(new Set(value.map((item) => text(item)).filter(Boolean))).slice(0, limit);
}

function hotspotCounts(values: string[], limit = 5) {
  const counts = new Map<string, number>();
  for (const value of values.map((item) => text(item)).filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function fieldFamily(field: string) {
  const normalized = text(field).toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("title")) return "positioning";
  if (normalized.includes("hook")) return "hook";
  if (normalized.includes("structure")) return "structure";
  if (normalized.includes("retention")) return "retention";
  if (normalized.includes("second-by-second") || normalized.includes("timeline")) return "timeline";
  if (normalized.includes("visual")) return "visual";
  if (normalized.includes("audio")) return "audio";
  if (normalized.includes("product fit")) return "offer-fit";
  if (normalized.includes("copy mechanic")) return "mechanic";
  if (normalized.includes("do-not-copy")) return "guardrails";
  if (normalized.includes("content action")) return "execution";
  if (normalized.includes("success metric")) return "measurement";
  return "other";
}

function completionScore(row: JsonRecord) {
  const missingFields = list(row.missing_fields, 6).length;
  const blockedReasons = list(row.blocked_reasons, 6).length;
  const lane = text(row.lane, "research");
  const laneBoost = lane === "ship" ? 18 : lane === "validate" ? 10 : 0;
  const exactBoost = text(row.proof_quality) === "exact_segment" ? 22 : 0;
  const readiness = Math.min(100, num(row.readiness_score));
  return Math.max(0, Math.round(
    readiness * 0.7
    + laneBoost
    + exactBoost
    - missingFields * 8
    - blockedReasons * 6,
  ));
}

export function buildReelsBrainShipReadyQueue(input: {
  briefCoverageAudit?: { gap_queue?: JsonRecord[]; summary?: JsonRecord | null } | null;
  segmentGenerationPacks?: { items?: JsonRecord[]; summary?: JsonRecord | null } | null;
  limit?: number;
}) {
  const gapQueue = records(input.briefCoverageAudit?.gap_queue);
  const packs = records(input.segmentGenerationPacks?.items);
  const packMap = new Map<string, JsonRecord>(
    packs.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const),
  );

  const items = gapQueue.map((row) => {
    const niche = text(row.niche, "unknown");
    const platform = text(row.platform, "unknown");
    const pack = (packMap.get(`${niche}__${platform}`) || {}) as JsonRecord;
    const missingFields = list(row.missing_fields, 6);
    const missingFamilies = uniq(missingFields.map((item) => fieldFamily(item)));
    const blockedReasons = list(row.blocked_reasons, 6);
    const readinessScore = Math.max(num(row.readiness_score), num(pack.readiness_score));
    const shipDelta = completionScore({
      ...row,
      readiness_score: readinessScore,
    });
    return {
      niche,
      platform,
      label: text(row.label, `${niche} × ${platform}`),
      lane: text(row.lane, "research"),
      proof_quality: text(row.proof_quality, "untraced"),
      readiness_score: readinessScore,
      missing_fields: missingFields,
      missing_field_families: missingFamilies,
      blocked_reasons: blockedReasons,
      next_step: text(row.next_step, "Close output gap and rebuild exact-ready brief."),
      ship_readiness_score: shipDelta,
      exact_ready: text(row.proof_quality) === "exact_segment",
      blocked_count: blockedReasons.length,
      missing_count: missingFields.length,
      primary_missing_family: missingFamilies[0] || "",
      field_fill_order: missingFields.slice(0, 3),
      generation_modes: list((pack.quality_gate as JsonRecord | null)?.allowed_generation_modes, 4),
    };
  }).sort((a, b) =>
    b.ship_readiness_score - a.ship_readiness_score
    || Number(b.exact_ready) - Number(a.exact_ready)
    || b.readiness_score - a.readiness_score
    || a.label.localeCompare(b.label),
  );

  const shipCandidates = items.filter((row) => row.lane === "ship");
  const validateCandidates = items.filter((row) => row.lane === "validate");
  const missingFieldHotspots = hotspotCounts(items.flatMap((row) => row.missing_fields));
  const missingFamilyHotspots = hotspotCounts(items.flatMap((row) => row.missing_field_families));

  return {
    summary: {
      total_gaps: items.length,
      ship_candidates: shipCandidates.length,
      validate_candidates: validateCandidates.length,
      exact_ready_gaps: items.filter((row) => row.exact_ready).length,
      avg_ship_readiness_score: items.length ? Math.round(items.reduce((sum, row) => sum + row.ship_readiness_score, 0) / items.length) : 0,
      top_ship_ready_pct: pct(shipCandidates.filter((row) => row.ship_readiness_score >= 70).length, Math.max(1, shipCandidates.length)),
      missing_field_hotspots: missingFieldHotspots,
      missing_family_hotspots: missingFamilyHotspots,
    },
    top_ship_candidates: shipCandidates.slice(0, Math.max(3, input.limit || 8)),
    top_validate_candidates: validateCandidates.slice(0, Math.max(3, input.limit || 8)),
    items: items.slice(0, Math.max(4, input.limit || 8)),
    next_step: items.length
      ? "Сначала закрывать top ship-ready gaps: они быстрее всего превращаются в production-grade exact briefs."
      : "Ship-ready queue чистая: usable exact-ready library уже собрана без критичных output-gap-ов.",
  };
}
