type SegmentTrustRow = {
  niche?: string;
  platform?: string;
  score?: number;
  status?: "ready" | "warming" | "weak" | string;
  confidence?: "high" | "medium" | "low" | string;
  note?: string;
};

type PatternRow = {
  id?: string;
  title?: string;
  hook?: string;
  retention?: string;
  format?: string;
  op_score?: number;
  confidence?: "high" | "medium" | "low" | string;
  quality_gate?: "high_confidence" | "medium_confidence" | "experimental" | "noise" | "banned" | string;
  effective_quality_gate?: "high_confidence" | "medium_confidence" | "experimental" | "noise" | "banned" | string;
  final_decision?: "scale" | "control" | "watch" | string;
  niches?: string[];
  platforms?: string[];
  market_signal?: {
    status?: "proven" | "promising" | "weak" | "no_feedback" | string;
    confidence?: "high" | "medium" | "low" | string;
    best_platform?: string | null;
    winners?: number;
    total_posts?: number;
  } | null;
  creative_brief?: {
    hook?: string;
    retention_mechanic?: string;
    second_by_second?: string[];
    visual_recipe?: string[];
    audio_strategy?: string[];
    product_fit?: string[];
    do_not_copy?: string[];
  } | null;
};

function liveQualityGate(pattern: PatternRow) {
  return text(pattern.effective_quality_gate || pattern.quality_gate);
}

type SegmentSummaryRow = {
  niche: string;
  platform_brains?: Record<string, {
    total_videos?: number;
    analyzed_videos?: number;
    patterns?: number;
    generator_ready_patterns?: number;
  }>;
};

type SegmentReadinessRow = {
  niche?: string;
  platform?: string;
  total_backlog?: number;
  dominant_gap?: {
    key?: string;
    count?: number;
  };
  direct_rate?: number;
  audio_rate?: number;
  transcript_ready_rate?: number;
  analyzed_rate?: number;
};

type SegmentPriorityRow = {
  niche?: string;
  platform?: string;
  decision_priority_score?: number;
  urgency_score?: number;
  ready_for_generation?: boolean;
  policy_mode?: string;
  recommended_upgrade?: {
    projected_trust_gain_score?: number;
    projected_production_state?: string;
    unlocked_output?: string;
  } | null;
};

type SegmentPolicyRow = {
  niche?: string;
  platform?: string;
  policy_mode?: string;
  trust_band?: string;
  evidence_band?: string;
  high_trust_generation_ready?: boolean;
  proof_quality?: string;
  publishable_exact?: boolean;
  policy_reason?: string;
  decision_priority_score?: number;
  recommended_upgrade?: {
    projected_trust_gain_score?: number;
    projected_production_state?: string;
    unlocked_output?: string;
  } | null;
  next_upgrade?: {
    projected_trust_gain_score?: number;
    projected_production_state?: string;
    unlocked_output?: string;
  } | null;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

function qualityWeight(value: string) {
  if (value === "high_confidence") return 20;
  if (value === "medium_confidence") return 12;
  if (value === "experimental") return 4;
  return 0;
}

function decisionWeight(value: string) {
  if (value === "scale") return 14;
  if (value === "control") return 8;
  return 0;
}

function confidenceWeight(value: string) {
  if (value === "high") return 10;
  if (value === "medium") return 6;
  return 2;
}

function marketWeight(value: string) {
  if (value === "proven") return 12;
  if (value === "promising") return 7;
  if (value === "weak") return -4;
  return 0;
}

function recommendationMode(nicheStatus: string, platformStatus: string) {
  if (nicheStatus === "ready" && platformStatus === "ready") return "primary";
  if (nicheStatus === "weak" || platformStatus === "weak") return "research_only";
  return "control_only";
}

function atlasStatus(avgScore: number, stableCount: number, analyzed: number) {
  if (avgScore >= 80 && stableCount >= 3 && analyzed >= 40) return "stable";
  if (avgScore >= 58 && stableCount >= 1 && analyzed >= 15) return "forming";
  return "thin";
}

function readinessBlocked(row: SegmentReadinessRow | undefined) {
  if (!row) return false;
  const dominantGap = text(row.dominant_gap?.key || "");
  const totalBacklog = num(row.total_backlog);
  if (totalBacklog <= 0) return false;
  if (dominantGap === "media") return num(row.direct_rate) < 55;
  if (dominantGap === "audio") return num(row.audio_rate) < 45;
  if (dominantGap === "transcript") return num(row.transcript_ready_rate) < 40;
  return false;
}

function patternStabilityScore(pattern: PatternRow) {
  return clamp(
    Math.min(34, num(pattern.op_score) * 0.34)
    + qualityWeight(liveQualityGate(pattern))
    + decisionWeight(text(pattern.final_decision))
    + confidenceWeight(text(pattern.market_signal?.confidence || pattern.confidence))
    + marketWeight(text(pattern.market_signal?.status))
    + Math.min(10, num(pattern.market_signal?.winners) * 2),
  );
}

function policyModeScore(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "primary") return 3;
  if (raw === "control_only") return 2;
  return 1;
}

function segmentPrioritySignal(
  niche: string,
  platform: string,
  segmentPriorityMap: Map<string, SegmentPriorityRow>,
  segmentPolicyMap: Map<string, SegmentPolicyRow>,
) {
  const key = `${niche}__${platform}`;
  const priority = segmentPriorityMap.get(key);
  const policy = segmentPolicyMap.get(key);
  const upgrade = policy?.recommended_upgrade || policy?.next_upgrade || priority?.recommended_upgrade || null;
  return {
    segment_priority_score: Math.max(
      num(priority?.decision_priority_score),
      num(priority?.urgency_score),
      num(policy?.decision_priority_score),
      num(upgrade?.projected_trust_gain_score),
    ),
    segment_priority_mode: text(priority?.policy_mode || policy?.policy_mode) || "research_only",
    segment_ready_for_generation: Boolean(priority?.ready_for_generation),
    trust_band: text(policy?.trust_band || "unknown"),
    evidence_band: text(policy?.evidence_band || "unknown"),
    high_trust_generation_ready: Boolean(policy?.high_trust_generation_ready),
    publishable_exact: Boolean(policy?.publishable_exact),
    proof_quality: text(policy?.proof_quality || "untraced"),
    policy_reason: text(policy?.policy_reason),
    projected_trust_gain_score: num(upgrade?.projected_trust_gain_score),
    projected_production_state: text(upgrade?.projected_production_state),
    unlocked_output: text(upgrade?.unlocked_output),
  };
}

export function buildReelsBrainPatternAtlas(input: {
  patterns: PatternRow[];
  nicheSummaries: SegmentSummaryRow[];
  segmentTrust: {
    by_niche?: SegmentTrustRow[];
    by_platform?: SegmentTrustRow[];
  };
  segmentReadiness?: SegmentReadinessRow[];
  platforms?: string[];
  segmentLimit?: number;
  patternLimit?: number;
  segmentPriorityQueue?: SegmentPriorityRow[];
  generationPolicy?: {
    by_segment?: SegmentPolicyRow[];
  } | null;
}) {
  const nicheTrustByKey = new Map((input.segmentTrust.by_niche || []).map((row) => [text(row.niche), row]));
  const platformTrustByKey = new Map((input.segmentTrust.by_platform || []).map((row) => [text(row.platform), row]));
  const nicheSummaryByKey = new Map((input.nicheSummaries || []).map((row) => [row.niche, row]));
  const readinessByKey = new Map((input.segmentReadiness || []).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const segmentPriorityMap = new Map((input.segmentPriorityQueue || []).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const segmentPolicyMap = new Map((((input.generationPolicy?.by_segment) || []) as SegmentPolicyRow[]).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const platforms = input.platforms || ["tiktok", "instagram", "youtube"];
  const segmentLimit = Math.max(4, input.segmentLimit || 8);
  const patternLimit = Math.max(2, input.patternLimit || 3);

  const bySegment = (input.nicheSummaries || []).flatMap((nicheRow) =>
    platforms.map((platform) => {
      const niche = text(nicheRow.niche);
      const platformStats = nicheRow.platform_brains?.[platform] || {};
      const nicheTrust = nicheTrustByKey.get(niche) || {};
      const platformTrust = platformTrustByKey.get(platform) || {};
      const readiness = readinessByKey.get(`${niche}__${platform}`);
      const stablePatterns = (input.patterns || [])
        .filter((pattern) => list(pattern.niches).includes(niche) && list(pattern.platforms).includes(platform))
        .map((pattern) => {
          const stability = patternStabilityScore(pattern);
          return {
            id: text(pattern.id),
            title: text(pattern.title),
            hook: text(pattern.creative_brief?.hook || pattern.hook),
            retention: text(pattern.creative_brief?.retention_mechanic || pattern.retention),
            format: text(pattern.format),
            op_score: num(pattern.op_score),
            stability_score: stability,
            quality_gate: liveQualityGate(pattern),
            final_decision: text(pattern.final_decision),
            confidence: text(pattern.market_signal?.confidence || pattern.confidence),
            market_status: text(pattern.market_signal?.status),
            winners: num(pattern.market_signal?.winners),
            total_posts: num(pattern.market_signal?.total_posts),
            best_platform: text(pattern.market_signal?.best_platform),
            brief_seed: {
              hook: text(pattern.creative_brief?.hook || pattern.hook),
              retention: text(pattern.creative_brief?.retention_mechanic || pattern.retention),
              visual_recipe: list(pattern.creative_brief?.visual_recipe).slice(0, 3),
              audio_strategy: list(pattern.creative_brief?.audio_strategy).slice(0, 3),
              product_fit: list(pattern.creative_brief?.product_fit).slice(0, 3),
              do_not_copy: list(pattern.creative_brief?.do_not_copy).slice(0, 3),
            },
          };
        })
        .filter((pattern) => pattern.stability_score >= 45 && pattern.quality_gate !== "noise" && pattern.quality_gate !== "banned")
        .sort((a, b) =>
          b.stability_score - a.stability_score
          || b.op_score - a.op_score
          || b.winners - a.winners
          || a.title.localeCompare(b.title),
        );

      const avgStableScore = stablePatterns.length
        ? Math.round(stablePatterns.reduce((sum, row) => sum + row.stability_score, 0) / stablePatterns.length)
        : 0;
      const analyzed = num(platformStats.analyzed_videos);
      const total = num(platformStats.total_videos);
      const analyzedRate = total > 0 ? Math.round((analyzed / total) * 100) : 0;
      const readinessThin = readinessBlocked(readiness);
      const mode = readinessThin ? "research_only" : recommendationMode(text(nicheTrust.status), text(platformTrust.status));
      const baseStatus = atlasStatus(avgStableScore, stablePatterns.length, analyzed);
      const status = readinessThin
        ? baseStatus === "stable"
          ? "forming"
          : "thin"
        : baseStatus;
      const priority = segmentPrioritySignal(niche, platform, segmentPriorityMap, segmentPolicyMap);

      return {
        niche,
        platform,
        status,
        recommended_mode: mode,
        segment_priority_score: priority.segment_priority_score,
        segment_priority_mode: priority.segment_priority_mode,
        segment_ready_for_generation: priority.segment_ready_for_generation,
        trust_band: priority.trust_band || "unknown",
        evidence_band: priority.evidence_band || "unknown",
        high_trust_generation_ready: priority.high_trust_generation_ready,
        publishable_exact: priority.publishable_exact,
        proof_quality: priority.proof_quality || "untraced",
        policy_reason: priority.policy_reason || "",
        projected_trust_gain_score: priority.projected_trust_gain_score,
        projected_production_state: priority.projected_production_state,
        unlocked_output: priority.unlocked_output,
        readiness_backed: !readinessThin,
        readiness_status: readinessThin ? "thin" : "backed",
        readiness_note: readinessThin
          ? `Foundation ещё сырой: ${text(readiness?.dominant_gap?.key || "readiness")} gap ${num(readiness?.total_backlog)}`
          : "Segment подкреплён media/audio/transcript coverage.",
        niche_trust_score: num(nicheTrust.score),
        niche_trust_status: text(nicheTrust.status),
        niche_note: text(nicheTrust.note),
        platform_trust_score: num(platformTrust.score),
        platform_trust_status: text(platformTrust.status),
        platform_note: text(platformTrust.note),
        total_videos: total,
        analyzed_videos: analyzed,
        analyzed_rate: analyzedRate,
        readiness_direct_rate: num(readiness?.direct_rate),
        readiness_audio_rate: num(readiness?.audio_rate),
        readiness_transcript_ready_rate: num(readiness?.transcript_ready_rate),
        readiness_analyzed_rate: num(readiness?.analyzed_rate),
        readiness_total_backlog: num(readiness?.total_backlog),
        readiness_dominant_gap: text(readiness?.dominant_gap?.key),
        patterns_in_memory: num(platformStats.patterns),
        generator_ready_patterns: num(platformStats.generator_ready_patterns),
        stable_pattern_count: stablePatterns.length,
        avg_stability_score: avgStableScore,
        summary: {
          high_confidence: stablePatterns.filter((row) => row.quality_gate === "high_confidence").length,
          medium_confidence: stablePatterns.filter((row) => row.quality_gate === "medium_confidence").length,
          scale_candidates: stablePatterns.filter((row) => row.final_decision === "scale").length,
          control_candidates: stablePatterns.filter((row) => row.final_decision === "control").length,
        },
        top_patterns: stablePatterns.slice(0, patternLimit),
        next_step: status === "stable"
          ? "Можно собирать platform-specific и niche-specific briefs из этого сегмента."
          : status === "forming"
            ? readinessThin
              ? "Паттерны уже заметны, но сначала нужно дожать media/audio/transcript foundation."
              : "Сегмент уже полезен для control-решений, но ему нужен ещё один цикл анализа."
            : "Сначала добрать analyzed и generator-ready слой, потом строить решения.",
      };
    }),
  )
    .filter((row) =>
      row.total_videos > 0
      || row.analyzed_videos > 0
      || row.generator_ready_patterns > 0
      || row.stable_pattern_count > 0,
    )
    .sort((a, b) =>
      policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
      || Number(Boolean(b.high_trust_generation_ready)) - Number(Boolean(a.high_trust_generation_ready))
      || Number(Boolean(b.publishable_exact)) - Number(Boolean(a.publishable_exact))
      || Number(b.proof_quality === "exact_segment") - Number(a.proof_quality === "exact_segment")
      || b.segment_priority_score - a.segment_priority_score
      || b.avg_stability_score - a.avg_stability_score
      || b.stable_pattern_count - a.stable_pattern_count
      || b.analyzed_videos - a.analyzed_videos
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  const byNiche = Array.from(new Set(bySegment.map((row) => row.niche))).map((niche) => {
    const items = bySegment.filter((row) => row.niche === niche);
    const nicheTrust = nicheTrustByKey.get(niche) || {};
    return {
      niche,
      trust_score: num(nicheTrust.score),
      trust_status: text(nicheTrust.status),
      stable_segments: items.filter((row) => row.status === "stable").length,
      best_platforms: items.slice(0, 3).map((row) => row.platform),
      top_patterns: items.flatMap((row) => row.top_patterns.map((pattern) => ({ ...pattern, platform: row.platform }))).slice(0, patternLimit),
    };
  }).sort((a, b) => b.trust_score - a.trust_score || b.stable_segments - a.stable_segments || a.niche.localeCompare(b.niche));

  const byPlatform = platforms.map((platform) => {
    const items = bySegment.filter((row) => row.platform === platform);
    const platformTrust = platformTrustByKey.get(platform) || {};
    return {
      platform,
      trust_score: num(platformTrust.score),
      trust_status: text(platformTrust.status),
      stable_segments: items.filter((row) => row.status === "stable").length,
      best_niches: items.slice(0, 3).map((row) => row.niche),
      top_patterns: items.flatMap((row) => row.top_patterns.map((pattern) => ({ ...pattern, niche: row.niche }))).slice(0, patternLimit),
    };
  }).sort((a, b) => b.trust_score - a.trust_score || b.stable_segments - a.stable_segments || a.platform.localeCompare(b.platform));

  const totals = {
    segments: bySegment.length,
    stable_segments: bySegment.filter((row) => row.status === "stable").length,
    forming_segments: bySegment.filter((row) => row.status === "forming").length,
    thin_segments: bySegment.filter((row) => row.status === "thin").length,
    atlas_ready_patterns: bySegment.reduce((sum, row) => sum + row.stable_pattern_count, 0),
    primary_priority_segments: bySegment.filter((row) => row.segment_priority_mode === "primary").length,
    ready_for_generation: bySegment.filter((row) => row.segment_ready_for_generation).length,
    exact_proof_ready: bySegment.filter((row) => row.proof_quality === "exact_segment").length,
    generation_ready: bySegment.filter((row) => row.high_trust_generation_ready).length,
  };

  const topSegments = bySegment.slice(0, segmentLimit);
  const champions = topSegments.slice(0, 3).map((row) => ({
    niche: row.niche,
    platform: row.platform,
    label: `${row.niche} × ${row.platform}`,
    avg_stability_score: row.avg_stability_score,
    stable_pattern_count: row.stable_pattern_count,
    leading_pattern: row.top_patterns[0]?.title || "",
  }));

  return {
    summary: totals,
    champions,
    by_segment: topSegments,
    by_niche: byNiche.slice(0, segmentLimit),
    by_platform: byPlatform.slice(0, platforms.length),
    lookup: {
      hasStableAtlas: totals.stable_segments > 0,
      strongestSegment: champions[0]?.label || "",
      weakestReason: topSegments.at(-1)?.next_step || "",
    },
  };
}
