export type ReelsBrainBriefRecipe = {
  id?: string;
  title?: string;
  hook?: string;
  format?: string;
  retention?: string;
  op_score?: number;
  confidence?: "high" | "medium" | "low" | string;
  niches?: string[];
  platforms?: string[];
  creative_brief?: {
    hook?: string;
    retention_mechanic?: string;
    second_by_second?: string[];
    visual_recipe?: string[];
    audio_strategy?: string[];
    product_fit?: string[];
    copy_as_mechanic?: string[];
    do_not_copy?: string[];
  } | null;
  examples?: Array<{
    reference_id?: string;
    url?: string | null;
    score?: number;
    views?: number;
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
  decision_priority_score?: number;
  trust_band?: string;
  evidence_band?: string;
  high_trust_generation_ready?: boolean;
  proof_quality?: string;
  publishable_exact?: boolean;
  outcome_status?: string;
  outcome_confidence?: string;
  policy_reason?: string;
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

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function list(value: unknown, limit = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean).slice(0, limit);
}

function segmentPairs(input: Array<{ niches?: string[]; platforms?: string[] }>) {
  const pairs = new Map<string, { niche: string; platform: string }>();
  for (const item of input) {
    for (const niche of list(item.niches, 20)) {
      for (const platform of list(item.platforms, 20)) {
        pairs.set(`${niche}__${platform}`, { niche, platform });
      }
    }
  }
  return Array.from(pairs.values()).sort((a, b) =>
    a.niche.localeCompare(b.niche) || a.platform.localeCompare(b.platform),
  );
}

function confidenceScore(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "high") return 3;
  if (raw === "medium") return 2;
  return 1;
}

function proofQualityRank(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "exact_segment") return 3;
  if (raw === "traced_transfer_only") return 2;
  return 1;
}

function policyModeScore(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "primary") return 3;
  if (raw === "control_only") return 2;
  return 1;
}

function sortPackRows<T extends {
  segment_priority_score?: number;
  segment_priority_mode?: string;
  effective_op_score?: number;
  confidence?: string;
  high_trust_generation_ready?: boolean;
  publishable_exact?: boolean;
  proof_quality?: string;
  title?: string;
}>(rows: T[]) {
  return rows.sort((a, b) =>
    policyModeScore(b.segment_priority_mode) - policyModeScore(a.segment_priority_mode)
    || Number(Boolean(b.high_trust_generation_ready)) - Number(Boolean(a.high_trust_generation_ready))
    || Number(Boolean(b.publishable_exact)) - Number(Boolean(a.publishable_exact))
    || proofQualityRank(b.proof_quality) - proofQualityRank(a.proof_quality)
    || num(b.segment_priority_score) - num(a.segment_priority_score)
    || num(b.effective_op_score) - num(a.effective_op_score)
    || confidenceScore(b.confidence) - confidenceScore(a.confidence)
    || text(a.title).localeCompare(text(b.title)),
  );
}

function readinessPenalty(row: SegmentReadinessRow | undefined) {
  if (!row) return { penalty: 0, status: "unknown", flag: "" };
  const dominantGap = text(row.dominant_gap?.key || "");
  const totalBacklog = num(row.total_backlog);
  if (totalBacklog <= 0) return { penalty: 0, status: "backed", flag: "" };
  if (dominantGap === "media" && num(row.direct_rate) < 55) return { penalty: 18, status: "thin", flag: "media_gap" };
  if (dominantGap === "audio" && num(row.audio_rate) < 45) return { penalty: 16, status: "thin", flag: "audio_gap" };
  if (dominantGap === "transcript" && num(row.transcript_ready_rate) < 40) return { penalty: 12, status: "thin", flag: "transcript_gap" };
  return { penalty: 6, status: "watch", flag: dominantGap ? `${dominantGap}_watch` : "readiness_watch" };
}

function normalizeRecipe(
  recipe: ReelsBrainBriefRecipe,
  rank: number,
  readinessMap: Map<string, SegmentReadinessRow>,
  segmentPriorityMap: Map<string, SegmentPriorityRow>,
  segmentPolicyMap: Map<string, SegmentPolicyRow>,
) {
  const pairs = segmentPairs([recipe]);
  const readinessRows = pairs.map(({ niche, platform }) => readinessMap.get(`${niche}__${platform}`)).filter(Boolean) as SegmentReadinessRow[];
  const penalties = readinessRows.map((row) => readinessPenalty(row));
  const maxPenalty = penalties.reduce((max, item) => Math.max(max, item.penalty), 0);
  const segmentSignals = pairs.map(({ niche, platform }) => {
    const key = `${niche}__${platform}`;
    const priority = segmentPriorityMap.get(key);
    const policy = segmentPolicyMap.get(key);
    const upgrade = policy?.recommended_upgrade || policy?.next_upgrade || priority?.recommended_upgrade || null;
    const priorityScore = Math.max(
      num(priority?.decision_priority_score),
      num(priority?.urgency_score),
      num(policy?.decision_priority_score),
      num(upgrade?.projected_trust_gain_score),
    );
    return {
      niche,
      platform,
      label: `${niche} × ${platform}`,
      priority_score: priorityScore,
      priority_mode: text(priority?.policy_mode || policy?.policy_mode, "research_only"),
      ready_for_generation: Boolean(priority?.ready_for_generation),
      projected_trust_gain_score: num(upgrade?.projected_trust_gain_score),
      projected_production_state: text(upgrade?.projected_production_state),
      unlocked_output: text(upgrade?.unlocked_output),
      trust_band: text(policy?.trust_band, "low"),
      evidence_band: text(policy?.evidence_band, "missing"),
      proof_quality: text(policy?.proof_quality, "untraced"),
      outcome_status: text(policy?.outcome_status, "no_feedback"),
      outcome_confidence: text(policy?.outcome_confidence, "none"),
      high_trust_generation_ready: Boolean(policy?.high_trust_generation_ready),
      publishable_exact: Boolean(policy?.publishable_exact),
      policy_reason: text(policy?.policy_reason),
    };
  }).sort((a, b) =>
    policyModeScore(b.priority_mode) - policyModeScore(a.priority_mode)
    || b.priority_score - a.priority_score
    || Number(b.ready_for_generation) - Number(a.ready_for_generation)
    || b.projected_trust_gain_score - a.projected_trust_gain_score
    || proofQualityRank(b.proof_quality) - proofQualityRank(a.proof_quality)
    || a.label.localeCompare(b.label),
  );
  const primarySegmentSignal = segmentSignals[0] || null;
  const readinessStatus = penalties.some((item) => item.status === "thin")
    ? "thin"
    : penalties.some((item) => item.status === "watch")
      ? "watch"
      : penalties.length
        ? "backed"
        : "unknown";
  const readinessFlags = Array.from(new Set(penalties.map((item) => item.flag).filter(Boolean)));
  return {
    rank,
    recipe_id: text(recipe.id, `recipe_${rank}`),
    title: text(recipe.title, `Brief ${rank}`),
    op_score: num(recipe.op_score),
    effective_op_score: Math.max(0, num(recipe.op_score) - maxPenalty),
    segment_priority_score: primarySegmentSignal?.priority_score || 0,
    segment_priority_mode: primarySegmentSignal?.priority_mode || "research_only",
    segment_priority_label: primarySegmentSignal?.label || "",
    segment_ready_for_generation: primarySegmentSignal?.ready_for_generation || false,
    projected_trust_gain_score: primarySegmentSignal?.projected_trust_gain_score || 0,
    projected_production_state: primarySegmentSignal?.projected_production_state || "",
    unlocked_output: primarySegmentSignal?.unlocked_output || "",
    trust_band: primarySegmentSignal?.trust_band || "low",
    evidence_band: primarySegmentSignal?.evidence_band || "missing",
    proof_quality: primarySegmentSignal?.proof_quality || "untraced",
    outcome_status: primarySegmentSignal?.outcome_status || "no_feedback",
    outcome_confidence: primarySegmentSignal?.outcome_confidence || "none",
    high_trust_generation_ready: primarySegmentSignal?.high_trust_generation_ready || false,
    publishable_exact: primarySegmentSignal?.publishable_exact || false,
    policy_reason: primarySegmentSignal?.policy_reason || "",
    confidence: text(recipe.confidence, "low"),
    readiness_status: readinessStatus,
    readiness_flags: readinessFlags,
    platforms: list(recipe.platforms, 4),
    niches: list(recipe.niches, 4),
    hook: text(recipe.creative_brief?.hook || recipe.hook, "сильный хук"),
    retention: text(recipe.creative_brief?.retention_mechanic || recipe.retention, "удержание через proof"),
    format: text(recipe.format, "демонстрация"),
    creative_brief: {
      hook: text(recipe.creative_brief?.hook || recipe.hook, "сильный хук"),
      retention_mechanic: text(recipe.creative_brief?.retention_mechanic || recipe.retention, "удержание через proof"),
      second_by_second: list(recipe.creative_brief?.second_by_second, 5),
      visual_recipe: list(recipe.creative_brief?.visual_recipe, 4),
      audio_strategy: list(recipe.creative_brief?.audio_strategy, 3),
      product_fit: list(recipe.creative_brief?.product_fit, 3),
      copy_as_mechanic: list(recipe.creative_brief?.copy_as_mechanic, 3),
      do_not_copy: list(recipe.creative_brief?.do_not_copy, 3),
    },
    evidence: {
      references: Array.isArray(recipe.examples) ? recipe.examples.length : 0,
      top_reference: Array.isArray(recipe.examples) ? recipe.examples[0] || null : null,
    },
    trust: {
      trust_band: primarySegmentSignal?.trust_band || "low",
      evidence_band: primarySegmentSignal?.evidence_band || "missing",
      proof_quality: primarySegmentSignal?.proof_quality || "untraced",
      outcome_status: primarySegmentSignal?.outcome_status || "no_feedback",
      outcome_confidence: primarySegmentSignal?.outcome_confidence || "none",
      high_trust_generation_ready: primarySegmentSignal?.high_trust_generation_ready || false,
      publishable_exact: primarySegmentSignal?.publishable_exact || false,
      policy_reason: primarySegmentSignal?.policy_reason || "",
    },
  };
}

export function buildReelsBrainBriefPack(
  recipes: ReelsBrainBriefRecipe[],
  limit = 3,
  options?: {
    segmentReadiness?: SegmentReadinessRow[];
    segmentPriorityQueue?: SegmentPriorityRow[];
    generationPolicy?: {
      by_segment?: SegmentPolicyRow[];
    } | null;
  },
) {
  const readinessMap = new Map((options?.segmentReadiness || []).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const segmentPriorityMap = new Map((options?.segmentPriorityQueue || []).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const segmentPolicyMap = new Map((((options?.generationPolicy?.by_segment) || []) as SegmentPolicyRow[]).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const ranked = [...(recipes || [])]
    .sort((a, b) =>
      num(b.op_score) - num(a.op_score)
      || confidenceScore(b.confidence) - confidenceScore(a.confidence)
      || text(a.title).localeCompare(text(b.title)))
    .slice(0, Math.max(1, limit))
    .map((recipe, index) => normalizeRecipe(recipe, index + 1, readinessMap, segmentPriorityMap, segmentPolicyMap));
  const normalizedRanked = sortPackRows(ranked)
    .map((recipe, index) => ({ ...recipe, rank: index + 1 }));

  return {
    primary: normalizedRanked[0] || null,
    alternatives: normalizedRanked.slice(1),
    summary: {
      total: normalizedRanked.length,
      high_confidence: normalizedRanked.filter((item) => item.confidence === "high").length,
      medium_confidence: normalizedRanked.filter((item) => item.confidence === "medium").length,
      low_confidence: normalizedRanked.filter((item) => item.confidence !== "high" && item.confidence !== "medium").length,
      exact_proof_ready: normalizedRanked.filter((item) => item.proof_quality === "exact_segment").length,
      generation_ready: normalizedRanked.filter((item) => item.high_trust_generation_ready).length,
      weak_outcomes: normalizedRanked.filter((item) => item.outcome_status === "weak").length,
      readiness_backed: normalizedRanked.filter((item) => item.readiness_status === "backed").length,
      readiness_watch: normalizedRanked.filter((item) => item.readiness_status === "watch").length,
      readiness_thin: normalizedRanked.filter((item) => item.readiness_status === "thin").length,
      primary_policy_mode: text(normalizedRanked[0]?.segment_priority_mode, "research_only"),
      primary_segment_priority_score: num(normalizedRanked[0]?.segment_priority_score),
      ready_for_generation: normalizedRanked.filter((item) => item.segment_ready_for_generation).length,
      avg_op_score: normalizedRanked.length ? Math.round(normalizedRanked.reduce((sum, item) => sum + num(item.op_score), 0) / normalizedRanked.length) : 0,
    },
  };
}

export function buildGroupedReelsBrainBriefPacks(input: {
  recipes: ReelsBrainBriefRecipe[];
  niches?: string[];
  platforms?: string[];
  limit?: number;
  segmentReadiness?: SegmentReadinessRow[];
  segmentPriorityQueue?: SegmentPriorityRow[];
  generationPolicy?: {
    by_segment?: SegmentPolicyRow[];
  } | null;
}) {
  const recipes = input.recipes || [];
  const niches = Array.from(new Set((input.niches || recipes.flatMap((recipe) => list(recipe.niches, 20))).filter(Boolean))).sort();
  const platforms = Array.from(new Set((input.platforms || recipes.flatMap((recipe) => list(recipe.platforms, 20))).filter(Boolean))).sort();
  const options = {
    segmentReadiness: input.segmentReadiness,
    segmentPriorityQueue: input.segmentPriorityQueue,
    generationPolicy: input.generationPolicy,
  };
  const sortGroups = <T extends { primary?: { segment_priority_mode?: string; segment_priority_score?: number; effective_op_score?: number; confidence?: string; title?: string } | null }>(rows: T[]) =>
    rows.sort((a, b) =>
      policyModeScore(b.primary?.segment_priority_mode) - policyModeScore(a.primary?.segment_priority_mode)
      || Number(Boolean(b.primary?.high_trust_generation_ready)) - Number(Boolean(a.primary?.high_trust_generation_ready))
      || Number(Boolean(b.primary?.publishable_exact)) - Number(Boolean(a.primary?.publishable_exact))
      || proofQualityRank(b.primary?.proof_quality) - proofQualityRank(a.primary?.proof_quality)
      || num(b.primary?.segment_priority_score) - num(a.primary?.segment_priority_score)
      || num(b.primary?.effective_op_score) - num(a.primary?.effective_op_score)
      || confidenceScore(b.primary?.confidence) - confidenceScore(a.primary?.confidence)
      || text(a.primary?.title).localeCompare(text(b.primary?.title)),
    );
  return {
    by_niche: sortGroups(niches.map((niche) => ({
      niche,
      ...buildReelsBrainBriefPack(
        recipes.filter((recipe) => list(recipe.niches, 20).includes(niche)),
        input.limit || 3,
        options,
      ),
    })).filter((row) => row.primary)),
    by_platform: sortGroups(platforms.map((platform) => ({
      platform,
      ...buildReelsBrainBriefPack(
        recipes.filter((recipe) => list(recipe.platforms, 20).includes(platform)),
        input.limit || 3,
        options,
      ),
    })).filter((row) => row.primary)),
    by_segment: sortGroups(segmentPairs(recipes).map(({ niche, platform }) => ({
      niche,
      platform,
      ...buildReelsBrainBriefPack(
        recipes.filter((recipe) =>
          list(recipe.niches, 20).includes(niche) && list(recipe.platforms, 20).includes(platform)),
        input.limit || 3,
        options,
      ),
    })).filter((row) => row.primary)),
  };
}
