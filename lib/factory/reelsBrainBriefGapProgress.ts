type JsonRecord = Record<string, unknown>;

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function list(value: unknown, limit = 6): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, limit)
    : [];
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
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

function recommendedLoop(family: string, exactReady: boolean, blockedCount: number) {
  if (blockedCount > 0 && !exactReady) return "collect_exact_proof";
  if (["visual", "timeline", "hook", "mechanic", "positioning"].includes(family)) return "media_backfill";
  if (["audio", "retention"].includes(family)) return "audio_backfill";
  if (["execution", "measurement", "structure"].includes(family)) return "analyze_and_compact";
  return exactReady ? "analyze_and_compact" : "collect_exact_proof";
}

function closureStage(input: { exactReady: boolean; missingCount: number; blockedCount: number }) {
  if (input.exactReady && input.blockedCount === 0 && input.missingCount <= 1) return "one_field_away";
  if (input.exactReady && input.blockedCount <= 1 && input.missingCount <= 2) return "close_to_publishable";
  if (input.exactReady) return "exact_but_incomplete";
  return "needs_exact_proof";
}

export function buildReelsBrainBriefGapProgress(input: {
  briefCoverageAudit?: { gap_queue?: JsonRecord[]; summary?: JsonRecord | null } | null;
  shipReadyQueue?: { items?: JsonRecord[]; top_ship_candidates?: JsonRecord[]; summary?: JsonRecord | null } | null;
  limit?: number;
}) {
  const gapQueue = records(input.briefCoverageAudit?.gap_queue);
  const shipItems = records(input.shipReadyQueue?.items);
  const shipTop = records(input.shipReadyQueue?.top_ship_candidates);
  const merged = new Map<string, JsonRecord>();

  for (const row of [...shipTop, ...shipItems, ...gapQueue]) {
    const niche = text(row.niche);
    const platform = text(row.platform);
    if (!niche || !platform) continue;
    const key = `${niche}__${platform}`;
    if (!merged.has(key)) merged.set(key, row);
  }

  const items = Array.from(merged.values()).map((row) => {
    const exactReady = text(row.proof_quality) === "exact_segment";
    const missingFields = list(row.missing_fields, 6);
    const missingFamilies = list(row.missing_field_families, 6);
    const blockedReasons = list(row.blocked_reasons, 6);
    const missingCount = missingFields.length;
    const blockedCount = blockedReasons.length;
    const stage = closureStage({ exactReady, missingCount, blockedCount });
    const primaryFamily = text(row.primary_missing_family || missingFamilies[0]);
    const upliftScore = Math.max(0, Math.round(
      num(row.readiness_score) * 0.36
      + num(row.ship_readiness_score) * 0.38
      + (exactReady ? 18 : 0)
      - missingCount * 7
      - blockedCount * 5
    ));
    return {
      niche: text(row.niche),
      platform: text(row.platform),
      label: text(row.label, `${text(row.niche)} × ${text(row.platform)}`),
      lane: text(row.lane, "research"),
      proof_quality: text(row.proof_quality, "untraced"),
      readiness_score: num(row.readiness_score),
      ship_readiness_score: num(row.ship_readiness_score),
      exact_ready: exactReady,
      missing_fields: missingFields,
      missing_field_families: missingFamilies,
      blocked_reasons: blockedReasons,
      missing_count: missingCount,
      blocked_count: blockedCount,
      primary_missing_family: primaryFamily,
      closure_stage: stage,
      estimated_uplift_score: upliftScore,
      recommended_loop: recommendedLoop(primaryFamily, exactReady, blockedCount),
      next_step: text(row.next_step, "Close the remaining brief gaps."),
    };
  }).sort((a, b) =>
    b.estimated_uplift_score - a.estimated_uplift_score
    || Number(b.exact_ready) - Number(a.exact_ready)
    || a.missing_count - b.missing_count
    || a.blocked_count - b.blocked_count
    || a.label.localeCompare(b.label),
  );

  const oneFieldAway = items.filter((row) => row.closure_stage === "one_field_away").length;
  const closeToPublishable = items.filter((row) => row.closure_stage === "close_to_publishable").length;
  const exactButIncomplete = items.filter((row) => row.closure_stage === "exact_but_incomplete").length;

  return {
    summary: {
      total: items.length,
      one_field_away_segments: oneFieldAway,
      close_to_publishable_segments: closeToPublishable,
      exact_but_incomplete_segments: exactButIncomplete,
      publishable_if_closed_pct: pct(oneFieldAway + closeToPublishable, Math.max(1, items.length)),
      avg_uplift_score: items.length ? Math.round(items.reduce((sum, row) => sum + row.estimated_uplift_score, 0) / items.length) : 0,
      top_missing_family_hotspots: hotspotCounts(items.flatMap((row) => row.missing_field_families)),
      recommended_loop_hotspots: hotspotCounts(items.map((row) => row.recommended_loop)),
    },
    top_candidates: items.slice(0, Math.max(4, input.limit || 8)),
    next_step: items.length
      ? "Сначала дожимать сегменты one_field_away и close_to_publishable: они дают самый быстрый uplift до publishable exact."
      : "Критичных brief gap uplift-кандидатов не осталось.",
  };
}
