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

function uniq(value: string[], limit = 8) {
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

function exportCompleteness(row: JsonRecord) {
  const brief = (row.brief && typeof row.brief === "object" ? row.brief : {}) as JsonRecord;
  const action = (row.content_solution && typeof row.content_solution === "object" ? row.content_solution : {}) as JsonRecord;
  const missing = [
    !text(brief.title) ? "brief title" : "",
    !text(brief.hook) ? "hook" : "",
    !text(brief.retention) ? "retention" : "",
    !text(brief.structure) ? "structure" : "",
    !list(brief.second_by_second, 2).length ? "second-by-second timeline" : "",
    !list(brief.visual_recipe, 2).length ? "visual recipe" : "",
    !list(brief.audio_strategy, 2).length ? "audio strategy" : "",
    !list(brief.product_fit, 2).length ? "product fit" : "",
    !list(brief.copy_as_mechanic, 2).length ? "copy mechanic" : "",
    !list(brief.do_not_copy, 2).length ? "do-not-copy guardrails" : "",
    !text(action.action_title) ? "content action" : "",
    !text(action.success_metric) ? "success metric" : "",
  ].filter(Boolean);
  return {
    usable: missing.length === 0,
    missing,
    families: uniq(missing.map((item) => fieldFamily(item))),
  };
}

function statusRank(lane: string) {
  if (lane === "ship") return 3;
  if (lane === "validate") return 2;
  return 1;
}

type CoverageRow = {
  niche: string;
  platform: string;
  label: string;
  lane: string;
  proof_quality: string;
  exact_ready: boolean;
  usable_export: boolean;
  missing_fields: string[];
  missing_field_families: string[];
  blocked_reasons: string[];
  readiness_score: number;
  next_step: string;
};

function summarizeDimension<T extends "niche" | "platform">(rows: CoverageRow[], dimension: T) {
  const groups = new Map<string, CoverageRow[]>();
  for (const row of rows) {
    const key = row[dimension];
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }
  return Array.from(groups.entries()).map(([key, items]) => {
    const usableExactReady = items.filter((row) => row.usable_export && row.exact_ready).length;
    const exactReady = items.filter((row) => row.exact_ready).length;
    const shipLane = items.filter((row) => row.lane === "ship").length;
    const validateLane = items.filter((row) => row.lane === "validate").length;
    const blocked = items.filter((row) => !row.usable_export).length;
    const topGap = [...items]
      .filter((row) => !row.usable_export || !row.exact_ready)
      .sort((a, b) =>
        statusRank(b.lane) - statusRank(a.lane)
        || b.readiness_score - a.readiness_score
        || a.label.localeCompare(b.label),
      )[0] || null;
    return {
      [dimension]: key,
      label: key,
      total: items.length,
      usable_exact_ready: usableExactReady,
      exact_ready: exactReady,
      ship_lane: shipLane,
      validate_lane: validateLane,
      blocked,
      usable_exact_ready_pct: pct(usableExactReady, items.length),
      exact_ready_pct: pct(exactReady, items.length),
      top_gap: topGap ? {
        label: topGap.label,
        lane: topGap.lane,
        proof_quality: topGap.proof_quality,
        missing_fields: topGap.missing_fields,
        missing_field_families: topGap.missing_field_families,
        blocked_reasons: topGap.blocked_reasons,
        next_step: topGap.next_step,
      } : null,
    };
  }).sort((a, b) =>
    num(b.usable_exact_ready) - num(a.usable_exact_ready)
    || num(b.exact_ready) - num(a.exact_ready)
    || text(a.label).localeCompare(text(b.label)),
  );
}

export function buildReelsBrainBriefCoverageAudit(input: {
  segmentGenerationPacks?: { items?: JsonRecord[] } | null;
  segmentCreativeExports?: { items?: JsonRecord[] } | null;
  limit?: number;
}) {
  const exportsRows = records(input.segmentCreativeExports?.items);
  const packRows = records(input.segmentGenerationPacks?.items);
  const packMap = new Map<string, JsonRecord>(
    packRows.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const),
  );
  const items = exportsRows.map((row) => {
    const niche = text(row.niche, "unknown");
    const platform = text(row.platform, "unknown");
    const key = `${niche}__${platform}`;
    const pack = (packMap.get(key) || {}) as JsonRecord;
    const completeness = exportCompleteness(row);
    const lane = text(row.lane || row.generator_bundle && (row.generator_bundle as JsonRecord).lane, "research");
    const proofQuality = text((row.trust as JsonRecord | null)?.proof_quality || pack.proof_quality, "untraced");
    const blockedReasons = list((row.generator_bundle as JsonRecord | null)?.blocked_reasons || pack.quality_gate && (pack.quality_gate as JsonRecord).blocked_reasons, 5);
    const nextStep = text(row.next_step || pack.next_step)
      || (completeness.missing.length
        ? `Сначала закрыть ${completeness.missing.slice(0, 2).join(" + ")} и пересобрать publishable bundle.`
        : blockedReasons.length
          ? `Сначала снять блокер: ${blockedReasons[0]}.`
          : "Сначала закрыть quality gate и дозаполнить bundle.");
    return {
      niche,
      platform,
      label: text(row.label, `${niche} × ${platform}`),
      lane,
      proof_quality: proofQuality,
      exact_ready: proofQuality === "exact_segment" && lane === "ship",
      usable_export: completeness.usable && lane !== "research",
      missing_fields: completeness.missing,
      missing_field_families: completeness.families,
      blocked_reasons: blockedReasons,
      readiness_score: num(row.readiness_score || pack.readiness_score),
      next_step: nextStep,
    } satisfies CoverageRow;
  }).sort((a, b) =>
    Number(b.usable_export && b.exact_ready) - Number(a.usable_export && a.exact_ready)
    || statusRank(b.lane) - statusRank(a.lane)
    || b.readiness_score - a.readiness_score
    || a.label.localeCompare(b.label),
  );

  const usableExactReady = items.filter((row) => row.usable_export && row.exact_ready).length;
  const exactReady = items.filter((row) => row.exact_ready).length;
  const shipLane = items.filter((row) => row.lane === "ship").length;
  const validateLane = items.filter((row) => row.lane === "validate").length;
  const gapQueue = items
    .filter((row) => !row.usable_export || !row.exact_ready)
    .sort((a, b) =>
      statusRank(b.lane) - statusRank(a.lane)
      || b.readiness_score - a.readiness_score
      || a.label.localeCompare(b.label),
    )
    .slice(0, Math.max(4, input.limit || 8));
  const missingFieldHotspots = hotspotCounts(gapQueue.flatMap((row) => row.missing_fields));
  const missingFamilyHotspots = hotspotCounts(gapQueue.flatMap((row) => row.missing_field_families));
  const blockedReasonHotspots = hotspotCounts(gapQueue.flatMap((row) => row.blocked_reasons));

  return {
    summary: {
      total_segments: items.length,
      usable_exact_ready_briefs: usableExactReady,
      exact_ready_briefs: exactReady,
      ship_lane_briefs: shipLane,
      validate_lane_briefs: validateLane,
      usable_exact_ready_pct: pct(usableExactReady, items.length),
      exact_ready_pct: pct(exactReady, items.length),
      blocked_or_incomplete_segments: gapQueue.length,
      missing_field_hotspots: missingFieldHotspots,
      missing_family_hotspots: missingFamilyHotspots,
      blocked_reason_hotspots: blockedReasonHotspots,
    },
    by_niche: summarizeDimension(items, "niche").slice(0, Math.max(3, input.limit || 8)),
    by_platform: summarizeDimension(items, "platform").slice(0, Math.max(3, input.limit || 8)),
    gap_queue: gapQueue,
    next_step: gapQueue.length
      ? "Сначала закрыть missing fields и exact-ready gaps у сегментов из ship/validate lane, потом масштабировать creative packs."
      : "Usable exact-ready brief coverage уже собрана: можно масштабировать production-ready creative packs.",
  };
}
