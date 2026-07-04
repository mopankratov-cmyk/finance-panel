export type ReelsBrainSegmentTrustNiche = {
  niche: string;
  total_videos?: number;
  analyzed_videos?: number;
  patterns?: number;
  generator_ready_patterns?: number;
  understanding_score?: number;
  platform_brains?: Record<string, {
    total_videos?: number;
    analyzed_videos?: number;
    patterns?: number;
    generator_ready_patterns?: number;
  }>;
};

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function trustLabel(score: number) {
  if (score >= 78) return { status: "ready", confidence: "high" };
  if (score >= 52) return { status: "warming", confidence: "medium" };
  return { status: "weak", confidence: "low" };
}

function buildNicheTrust(row: ReelsBrainSegmentTrustNiche) {
  const totalVideos = num(row.total_videos);
  const analyzedVideos = num(row.analyzed_videos);
  const patterns = num(row.patterns);
  const readyPatterns = num(row.generator_ready_patterns);
  const understanding = num(row.understanding_score);
  const analyzedRate = totalVideos > 0 ? Math.round((analyzedVideos / totalVideos) * 100) : 0;
  const score = clamp(
    Math.min(38, understanding * 0.38)
    + Math.min(24, analyzedRate * 0.24)
    + Math.min(22, readyPatterns * 1.8)
    + Math.min(16, patterns * 0.8),
  );
  const trust = trustLabel(score);
  const strongPlatforms = Object.entries(row.platform_brains || {})
    .filter(([, item]) => num(item.generator_ready_patterns) >= 4 || num(item.analyzed_videos) >= 40)
    .map(([platform]) => platform);
  const weakPlatforms = Object.entries(row.platform_brains || {})
    .filter(([, item]) => num(item.generator_ready_patterns) < 2 && num(item.analyzed_videos) < 20)
    .map(([platform]) => platform);
  return {
    niche: row.niche,
    score,
    status: trust.status,
    confidence: trust.confidence,
    analyzed_rate: analyzedRate,
    total_videos: totalVideos,
    analyzed_videos: analyzedVideos,
    patterns,
    generator_ready_patterns: readyPatterns,
    strong_platforms: strongPlatforms,
    weak_platforms: weakPlatforms,
    note: trust.status === "ready"
      ? "Можно опираться на сегмент как на рабочий источник briefs и hypotheses."
      : trust.status === "warming"
        ? "Сегмент уже полезен для control-решений, но еще не для слепого масштаба."
        : "Сегмент пока слабый: использовать как разведку, а не как главный decision layer.",
  };
}

function buildPlatformTrust(input: { platform: string; rows: ReelsBrainSegmentTrustNiche[] }) {
  const buckets = input.rows.map((row) => ({
    niche: row.niche,
    total_videos: num(row.platform_brains?.[input.platform]?.total_videos),
    analyzed_videos: num(row.platform_brains?.[input.platform]?.analyzed_videos),
    patterns: num(row.platform_brains?.[input.platform]?.patterns),
    generator_ready_patterns: num(row.platform_brains?.[input.platform]?.generator_ready_patterns),
    understanding_score: num(row.understanding_score),
  }));
  const totalVideos = buckets.reduce((sum, row) => sum + row.total_videos, 0);
  const analyzedVideos = buckets.reduce((sum, row) => sum + row.analyzed_videos, 0);
  const patterns = buckets.reduce((sum, row) => sum + row.patterns, 0);
  const readyPatterns = buckets.reduce((sum, row) => sum + row.generator_ready_patterns, 0);
  const avgUnderstanding = buckets.length ? Math.round(buckets.reduce((sum, row) => sum + row.understanding_score, 0) / buckets.length) : 0;
  const analyzedRate = totalVideos > 0 ? Math.round((analyzedVideos / totalVideos) * 100) : 0;
  const score = clamp(
    Math.min(34, avgUnderstanding * 0.34)
    + Math.min(26, analyzedRate * 0.26)
    + Math.min(24, readyPatterns * 2)
    + Math.min(16, patterns * 0.7),
  );
  const trust = trustLabel(score);
  return {
    platform: input.platform,
    score,
    status: trust.status,
    confidence: trust.confidence,
    analyzed_rate: analyzedRate,
    total_videos: totalVideos,
    analyzed_videos: analyzedVideos,
    patterns,
    generator_ready_patterns: readyPatterns,
    strongest_niches: buckets
      .slice()
      .sort((a, b) => b.generator_ready_patterns - a.generator_ready_patterns || b.analyzed_videos - a.analyzed_videos)
      .filter((row) => row.generator_ready_patterns > 0 || row.analyzed_videos > 0)
      .slice(0, 3)
      .map((row) => row.niche),
    note: trust.status === "ready"
      ? "Платформа уже накопила достаточно сегментной памяти для platform-specific решений."
      : trust.status === "warming"
        ? "Платформа уже полезна для controlled rollout, но еще не везде равномерна."
        : "Платформа пока разогревается и требует больше analyzed / ready pattern слоя.",
  };
}

export function buildReelsBrainSegmentTrust(input: {
  niches: ReelsBrainSegmentTrustNiche[];
  platforms?: string[];
}) {
  const nicheRows = input.niches || [];
  const platforms = Array.from(new Set((input.platforms || ["tiktok", "instagram", "youtube"]).filter(Boolean)));
  return {
    by_niche: nicheRows
      .map((row) => buildNicheTrust(row))
      .sort((a, b) => b.score - a.score || a.niche.localeCompare(b.niche)),
    by_platform: platforms
      .map((platform) => buildPlatformTrust({ platform, rows: nicheRows }))
      .sort((a, b) => b.score - a.score || a.platform.localeCompare(b.platform)),
  };
}

export function segmentRecommendationMode(status: unknown) {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === "ready") return "primary";
  if (raw === "warming") return "control_only";
  return "research_only";
}

export function applySegmentTrustToGroups<
  TGroup extends Record<string, unknown>,
  TTrust extends { score?: number; status?: string; confidence?: string; note?: string }
>(input: {
  groups: TGroup[];
  trustRows: TTrust[];
  key: "niche" | "platform";
}) {
  const map = new Map<string, TTrust>(
    (input.trustRows || [])
      .map((row) => [String(row[input.key as keyof TTrust] || ""), row] as const)
      .filter(([value]) => value),
  );
  return [...(input.groups || [])]
    .map((group) => {
      const value = String(group[input.key] || "");
      const trust = map.get(value) || null;
      return {
        ...group,
        trust_score: trust?.score ?? 0,
        trust_status: trust?.status ?? "weak",
        trust_confidence: trust?.confidence ?? "low",
        trust_note: trust?.note ?? "",
        recommended_mode: segmentRecommendationMode(trust?.status),
        primary_allowed: segmentRecommendationMode(trust?.status) === "primary",
      };
    })
    .sort((a, b) =>
      Number(b.trust_score || 0) - Number(a.trust_score || 0)
      || Number((b.primary_allowed ? 1 : 0)) - Number((a.primary_allowed ? 1 : 0))
      || String(a[input.key] || "").localeCompare(String(b[input.key] || "")));
}
