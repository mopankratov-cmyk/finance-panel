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

function pct(current: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)));
}

function statusRank(value: string) {
  if (value === "missing_exact_segment") return 5;
  if (value === "borrowed_brief_only") return 4;
  if (value === "weak_exact_outcome") return 3;
  if (value === "thin_exact_segment") return 2;
  return 1;
}

export function buildReelsBrainExactSegmentQueue(input: {
  portfolioReadiness?: {
    summary?: JsonRecord | null;
    missing_segments?: JsonRecord[];
  } | null;
  segmentSolutionMatrix?: {
    by_niche?: JsonRecord[];
    by_platform?: JsonRecord[];
  } | null;
  generationPolicy?: {
    by_segment?: JsonRecord[];
  } | null;
  segmentPriorityQueue?: {
    items?: JsonRecord[];
  } | null;
  limit?: number;
}) {
  const missingSegments = records(input.portfolioReadiness?.missing_segments);
  const bySegmentPolicy = new Map(
    records(input.generationPolicy?.by_segment).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const),
  );
  const byPriority = new Map(
    records(input.segmentPriorityQueue?.items).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const),
  );
  const nicheMatrix = new Map(
    records(input.segmentSolutionMatrix?.by_niche).map((row) => [text(row.niche), row] as const),
  );
  const platformMatrix = new Map(
    records(input.segmentSolutionMatrix?.by_platform).map((row) => [text(row.platform).toLowerCase(), row] as const),
  );

  const items = missingSegments.map((segment) => {
    const niche = text(segment.niche);
    const platform = text(segment.platform).toLowerCase();
    const policy = (bySegmentPolicy.get(`${niche}__${platform}`) || {}) as JsonRecord;
    const priority = (byPriority.get(`${niche}__${platform}`) || {}) as JsonRecord;
    const nicheSupport = (nicheMatrix.get(niche) || {}) as JsonRecord;
    const platformSupport = (platformMatrix.get(platform) || {}) as JsonRecord;
    const nichePrimary = (nicheSupport.primary && typeof nicheSupport.primary === "object" ? nicheSupport.primary : {}) as JsonRecord;
    const platformPrimary = (platformSupport.primary && typeof platformSupport.primary === "object" ? platformSupport.primary : {}) as JsonRecord;
    const transferSupport = [
      text(platformPrimary.niche) && text(platformPrimary.niche) !== niche ? {
        source: "platform_transfer",
        label: text(platformPrimary.label, `${text(platformPrimary.niche)} × ${text(platformPrimary.platform)}`),
        matched_niche: text(platformPrimary.niche),
        matched_platform: text(platformPrimary.platform),
        trust_band: text(platformPrimary.trust_band, text(platformSupport.trust_band, "low")),
        evidence_band: text((platformPrimary.trust_summary as JsonRecord | undefined)?.evidence_band, text(platformSupport.evidence_band, "missing")),
        readiness_score: num(platformPrimary.readiness_score),
      } : null,
      text(nichePrimary.platform) && text(nichePrimary.platform).toLowerCase() !== platform ? {
        source: "niche_transfer",
        label: text(nichePrimary.label, `${text(nichePrimary.niche)} × ${text(nichePrimary.platform)}`),
        matched_niche: text(nichePrimary.niche),
        matched_platform: text(nichePrimary.platform),
        trust_band: text(nichePrimary.trust_band, text(nicheSupport.trust_band, "low")),
        evidence_band: text((nichePrimary.trust_summary as JsonRecord | undefined)?.evidence_band, text(nicheSupport.evidence_band, "missing")),
        readiness_score: num(nichePrimary.readiness_score),
      } : null,
    ].filter(Boolean);

    const missing = Boolean(segment.missing);
    const evidenceBand = text(segment.evidence_band, "missing");
    const outcomeStatus = text(segment.outcome_status, text(policy.outcome_status, "no_feedback"));
    const borrowedOnly = !missing && transferSupport.length > 0 && evidenceBand !== "stable";
    const status = missing
      ? "missing_exact_segment"
      : outcomeStatus === "weak"
        ? "weak_exact_outcome"
        : borrowedOnly
          ? "borrowed_brief_only"
          : evidenceBand === "thin"
            ? "thin_exact_segment"
            : "forming_exact_segment";
    const blockers = Array.from(new Set([
      ...list(segment.blockers, 4),
      ...list(priority.blockers, 3),
      borrowedOnly ? "brief пока опирается на соседний transfer signal, а не на exact segment proof" : "",
      status === "missing_exact_segment" ? "по exact niche × platform ещё нет устойчивого сегментного слоя" : "",
      status === "weak_exact_outcome" ? "рынок по exact segment пока не подтвердил механику" : "",
    ])).filter(Boolean).slice(0, 6);
    const urgencyScore = Math.round(
      (missing ? 42 : 0)
      + (borrowedOnly ? 28 : 0)
      + (outcomeStatus === "weak" ? 24 : 0)
      + Math.min(18, num(priority.urgency_score) * 0.2)
      + Math.min(14, num(segment.stability_score) * 0.18)
      + Math.min(10, transferSupport.length * 6)
      + (text(policy.policy_mode) === "primary" ? 16 : text(policy.policy_mode) === "control_only" ? 8 : 0),
    );

    return {
      niche,
      platform,
      label: `${niche} × ${platform}`,
      status,
      urgency_score: urgencyScore,
      exact_proof_missing: missing || borrowedOnly || outcomeStatus === "weak",
      exact_evidence_band: evidenceBand,
      exact_outcome_status: outcomeStatus,
      exact_stability_score: num(segment.stability_score),
      policy_mode: text(policy.policy_mode, "research_only"),
      current_action: text(priority.action || "watch_segment"),
      current_next_action: text(priority.next_action || priority.next_step || ""),
      transfer_support: transferSupport,
      blockers,
      desired_proof: missing
        ? "Собрать exact segment corpus и довести до первого stable segment layer."
        : borrowedOnly
          ? "Подтвердить, что exact segment работает сам по себе, а не только через соседний transfer."
          : outcomeStatus === "weak"
            ? "Пересобрать механику и добиться positive market outcome по exact segment."
            : "Дотянуть exact segment до stable + high-trust состояния.",
      next_training_move: text(priority.action || (missing ? "collect_segment_batch" : "analyze_segment_backlog")),
      transfer_count: transferSupport.length,
      readiness_gap: text(priority.readiness_dominant_gap),
      readiness_gap_count: num(priority.readiness_dominant_gap_count),
    };
  }).sort((a, b) =>
    statusRank(b.status) - statusRank(a.status)
    || b.urgency_score - a.urgency_score
    || b.transfer_count - a.transfer_count
    || a.label.localeCompare(b.label),
  );

  const exactReady = missingSegments.length - items.filter((row) => row.exact_proof_missing).length;
  const borrowed = items.filter((row) => row.status === "borrowed_brief_only").length;
  const weak = items.filter((row) => row.status === "weak_exact_outcome").length;
  const missing = items.filter((row) => row.status === "missing_exact_segment").length;
  const exactProven = Math.max(0, num((input.portfolioReadiness?.summary || {})["expected_segments"]) - items.length);

  return {
    summary: {
      total_gap_segments: items.length,
      exact_proven_segments: exactProven,
      exact_gap_segments: items.filter((row) => row.exact_proof_missing).length,
      missing_exact_segments: missing,
      borrowed_brief_segments: borrowed,
      weak_exact_outcome_segments: weak,
      exact_ready_segments: exactReady,
      exact_proof_coverage_pct: pct(exactProven, exactProven + items.length),
    },
    items: items.slice(0, Math.max(4, input.limit || 8)),
  };
}
