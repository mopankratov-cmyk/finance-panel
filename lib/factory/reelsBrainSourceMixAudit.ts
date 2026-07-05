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

function pct(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function riskBand(input: {
  total: number;
  exactReady: number;
  transferOnly: number;
  untraced: number;
  exactGapSegments: number;
}) {
  if (input.total === 0) return "high";
  if (input.exactReady >= Math.max(3, Math.ceil(input.total * 0.45)) && input.exactGapSegments <= Math.max(1, Math.floor(input.total * 0.25))) return "low";
  if (input.exactReady >= Math.max(1, Math.ceil(input.total * 0.2)) && input.transferOnly <= Math.ceil(input.total * 0.6)) return "medium";
  return "high";
}

export function buildReelsBrainSourceMixAudit(input: {
  segmentSolutions?: { items?: JsonRecord[] } | null;
  segmentGenerationPacks?: { items?: JsonRecord[] } | null;
  exactSegmentQueue?: { summary?: JsonRecord | null; items?: JsonRecord[] | null } | null;
  feedbackLoop?: { validation_trace?: JsonRecord | null } | null;
}) {
  const solutions = records(input.segmentSolutions?.items);
  const packs = records(input.segmentGenerationPacks?.items);
  const packMap = new Map<string, JsonRecord>(
    packs.map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const),
  );
  const exactGapSegments = num(input.exactSegmentQueue?.summary && (input.exactSegmentQueue.summary as JsonRecord).exact_gap_segments);
  const tracedPosts = num(input.feedbackLoop?.validation_trace && (input.feedbackLoop.validation_trace as JsonRecord).traced_posts);
  const exactTracePosts = num(input.feedbackLoop?.validation_trace && (input.feedbackLoop.validation_trace as JsonRecord).exact_segment_posts);
  const gapWatchlist = records(input.exactSegmentQueue?.items)
    .map((row) => ({
      niche: text(row.niche, "unknown"),
      platform: text(row.platform, "unknown"),
      label: text(row.label, `${text(row.niche, "unknown")} × ${text(row.platform, "unknown")}`),
      status: text(row.status, "unknown"),
      urgency_score: num(row.urgency_score),
      desired_proof: text(row.desired_proof),
      current_action: text(row.current_action),
      transfer_count: num(row.transfer_count),
    }))
    .sort((a, b) => b.urgency_score - a.urgency_score || a.label.localeCompare(b.label))
    .slice(0, 8);

  const items = solutions.map((row) => {
    const trust = (row.trust_summary && typeof row.trust_summary === "object" ? row.trust_summary : {}) as JsonRecord;
    const proofQuality = text(trust.proof_quality, "untraced");
    const platform = text(row.platform, "unknown");
    const niche = text(row.niche, "unknown");
    const key = `${niche}__${platform}`;
    const pack = (packMap.get(key) || {}) as JsonRecord;
    const gate = (pack.quality_gate && typeof pack.quality_gate === "object" ? pack.quality_gate : {}) as JsonRecord;
    return {
      niche,
      platform,
      label: text(row.label, `${niche} × ${platform}`),
      proof_quality: proofQuality,
      production_state: text(row.production_state, "research_only"),
      generation_gate: text(gate.status, "not_ready"),
      exact_segment_ready: Boolean(gate.exact_segment_ready),
    };
  });

  const exactReady = items.filter((row) => row.proof_quality === "exact_segment" && row.exact_segment_ready).length;
  const transferOnly = items.filter((row) => row.proof_quality === "traced_transfer_only").length;
  const untraced = items.filter((row) => row.proof_quality === "untraced").length;
  const risk = riskBand({
    total: items.length,
    exactReady,
    transferOnly,
    untraced,
    exactGapSegments,
  });
  const byPlatform = Array.from(items.reduce((map, row) => {
    const current = map.get(row.platform) || {
      platform: row.platform,
      total: 0,
      exact_ready: 0,
      transfer_only: 0,
      untraced: 0,
    };
    current.total += 1;
    if (row.proof_quality === "exact_segment" && row.exact_segment_ready) current.exact_ready += 1;
    if (row.proof_quality === "traced_transfer_only") current.transfer_only += 1;
    if (row.proof_quality === "untraced") current.untraced += 1;
    map.set(row.platform, current);
    return map;
  }, new Map<string, { platform: string; total: number; exact_ready: number; transfer_only: number; untraced: number }>()).values())
    .map((row) => ({
      ...row,
      exact_ready_pct: pct(row.exact_ready, row.total),
    }))
    .sort((a, b) => b.total - a.total || a.platform.localeCompare(b.platform));

  return {
    summary: {
      total_segment_solutions: items.length,
      exact_ready_solutions: exactReady,
      transfer_only_solutions: transferOnly,
      untraced_solutions: untraced,
      exact_ready_coverage_pct: pct(exactReady, items.length),
      exact_gap_segments: exactGapSegments,
      validation_traced_posts: tracedPosts,
      validation_exact_posts: exactTracePosts,
      legacy_fallback_policy: "guarded",
      fallback_dependency_risk: risk,
    },
    by_platform: byPlatform,
    by_niche: Array.from(items.reduce((map, row) => {
      const current = map.get(row.niche) || {
        niche: row.niche,
        total: 0,
        exact_ready: 0,
        transfer_only: 0,
        untraced: 0,
      };
      current.total += 1;
      if (row.proof_quality === "exact_segment" && row.exact_segment_ready) current.exact_ready += 1;
      if (row.proof_quality === "traced_transfer_only") current.transfer_only += 1;
      if (row.proof_quality === "untraced") current.untraced += 1;
      map.set(row.niche, current);
      return map;
    }, new Map<string, { niche: string; total: number; exact_ready: number; transfer_only: number; untraced: number }>()).values())
      .map((row) => ({
        ...row,
        exact_ready_pct: pct(row.exact_ready, row.total),
      }))
      .sort((a, b) => b.total - a.total || a.niche.localeCompare(b.niche)),
    exact_gap_watchlist: gapWatchlist,
    next_step: risk === "low"
      ? "Большая часть production-решений уже идёт через exact-ready segment layer; можно дальше снижать долю legacy path."
      : risk === "medium"
        ? "Нужно добирать exact-proof по platform/niche сегментам с transfer-only статусом и постепенно вытеснять legacy path."
        : "Слишком много решений ещё завязано на transfer-only или untraced слой; сначала дожать exact-proof coverage, потом масштабировать генерацию.",
  };
}
