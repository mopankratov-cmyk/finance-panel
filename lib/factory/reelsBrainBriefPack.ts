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
) {
  const pairs = segmentPairs([recipe]);
  const readinessRows = pairs.map(({ niche, platform }) => readinessMap.get(`${niche}__${platform}`)).filter(Boolean) as SegmentReadinessRow[];
  const penalties = readinessRows.map((row) => readinessPenalty(row));
  const maxPenalty = penalties.reduce((max, item) => Math.max(max, item.penalty), 0);
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
  };
}

export function buildReelsBrainBriefPack(
  recipes: ReelsBrainBriefRecipe[],
  limit = 3,
  options?: {
    segmentReadiness?: SegmentReadinessRow[];
  },
) {
  const readinessMap = new Map((options?.segmentReadiness || []).map((row) => [`${text(row.niche)}__${text(row.platform)}`, row]));
  const ranked = [...(recipes || [])]
    .sort((a, b) =>
      num(b.op_score) - num(a.op_score)
      || confidenceScore(b.confidence) - confidenceScore(a.confidence)
      || text(a.title).localeCompare(text(b.title)))
    .slice(0, Math.max(1, limit))
    .map((recipe, index) => normalizeRecipe(recipe, index + 1, readinessMap))
    .sort((a, b) =>
      num(b.effective_op_score) - num(a.effective_op_score)
      || confidenceScore(b.confidence) - confidenceScore(a.confidence)
      || text(a.title).localeCompare(text(b.title)),
    )
    .map((recipe, index) => ({ ...recipe, rank: index + 1 }));

  return {
    primary: ranked[0] || null,
    alternatives: ranked.slice(1),
    summary: {
      total: ranked.length,
      high_confidence: ranked.filter((item) => item.confidence === "high").length,
      medium_confidence: ranked.filter((item) => item.confidence === "medium").length,
      low_confidence: ranked.filter((item) => item.confidence !== "high" && item.confidence !== "medium").length,
      readiness_backed: ranked.filter((item) => item.readiness_status === "backed").length,
      readiness_watch: ranked.filter((item) => item.readiness_status === "watch").length,
      readiness_thin: ranked.filter((item) => item.readiness_status === "thin").length,
      avg_op_score: ranked.length ? Math.round(ranked.reduce((sum, item) => sum + num(item.op_score), 0) / ranked.length) : 0,
    },
  };
}

export function buildGroupedReelsBrainBriefPacks(input: {
  recipes: ReelsBrainBriefRecipe[];
  niches?: string[];
  platforms?: string[];
  limit?: number;
  segmentReadiness?: SegmentReadinessRow[];
}) {
  const recipes = input.recipes || [];
  const niches = Array.from(new Set((input.niches || recipes.flatMap((recipe) => list(recipe.niches, 20))).filter(Boolean))).sort();
  const platforms = Array.from(new Set((input.platforms || recipes.flatMap((recipe) => list(recipe.platforms, 20))).filter(Boolean))).sort();
  return {
    by_niche: niches.map((niche) => ({
      niche,
      ...buildReelsBrainBriefPack(
        recipes.filter((recipe) => list(recipe.niches, 20).includes(niche)),
        input.limit || 3,
        { segmentReadiness: input.segmentReadiness },
      ),
    })).filter((row) => row.primary),
    by_platform: platforms.map((platform) => ({
      platform,
      ...buildReelsBrainBriefPack(
        recipes.filter((recipe) => list(recipe.platforms, 20).includes(platform)),
        input.limit || 3,
        { segmentReadiness: input.segmentReadiness },
      ),
    })).filter((row) => row.primary),
    by_segment: segmentPairs(recipes).map(({ niche, platform }) => ({
      niche,
      platform,
      ...buildReelsBrainBriefPack(
        recipes.filter((recipe) =>
          list(recipe.niches, 20).includes(niche) && list(recipe.platforms, 20).includes(platform)),
        input.limit || 3,
        { segmentReadiness: input.segmentReadiness },
      ),
    })).filter((row) => row.primary),
  };
}
