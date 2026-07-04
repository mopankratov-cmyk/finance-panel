import { corpusTargetByNiche, corpusTargetByPlatform, REELS_BRAIN_CORPUS_TARGET_TOTAL } from "./reelsBrainCorpusTargets";

type PlatformKey = "tiktok" | "instagram" | "youtube";

type NicheSummaryRow = {
  niche: string;
  platform_brains?: Record<string, {
    total_videos?: number;
    analyzed_videos?: number;
    patterns?: number;
    generator_ready_patterns?: number;
  }>;
};

type AtlasSegment = {
  niche?: string;
  platform?: string;
  status?: "stable" | "forming" | "thin" | string;
  stable_pattern_count?: number;
  avg_stability_score?: number;
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundSegmentTargets(nicheTarget: number, byPlatform: Record<PlatformKey, number>) {
  const totalPlatformTarget = byPlatform.tiktok + byPlatform.instagram + byPlatform.youtube;
  const tiktok = Math.round((nicheTarget * byPlatform.tiktok) / totalPlatformTarget);
  const instagram = Math.round((nicheTarget * byPlatform.instagram) / totalPlatformTarget);
  const youtube = Math.max(0, nicheTarget - tiktok - instagram);
  return { tiktok, instagram, youtube };
}

function segmentStatus(input: {
  activationGap: number;
  analyzedGap: number;
  readyGap: number;
  stableGap: number;
  atlasStatus: string;
}) {
  if (input.atlasStatus === "stable") return "stable";
  if (input.activationGap <= 0 && input.analyzedGap <= 0 && input.readyGap <= 0 && input.stableGap <= 0) return "stable";
  if (input.activationGap > 0) return "grow_corpus";
  if (input.analyzedGap > 0) return "analyze_more";
  return "build_patterns";
}

function segmentNextAction(input: {
  status: string;
  totalGap: number;
  activationGap: number;
  analyzedGap: number;
  readyGap: number;
  stableGap: number;
}) {
  if (input.status === "grow_corpus") {
    return `Добрать ещё ${input.activationGap} видео до trust-floor этого сегмента.`;
  }
  if (input.status === "analyze_more") {
    return `Довести в analyze ещё ${input.analyzedGap} видео, прежде чем покупать новый корпус.`;
  }
  if (input.status === "build_patterns") {
    return `Нужно собрать ещё ${input.readyGap} ready-pattern и ${input.stableGap} stable-pattern, чтобы сегмент стал decision-grade.`;
  }
  if (input.totalGap > 0) {
    return `Сегмент уже decision-grade, но до стратегической цели 10k ещё нужно добрать ${input.totalGap} видео.`;
  }
  return "Сегмент уже может служить high-trust основой для briefs и hypotheses.";
}

export function buildReelsBrainSegmentGapPlanner(input: {
  niches: NicheSummaryRow[];
  patternAtlas?: { by_segment?: AtlasSegment[] };
  targetTotal?: number;
  platforms?: PlatformKey[];
  limit?: number;
}) {
  const targetTotal = Math.max(300, num(input.targetTotal) || REELS_BRAIN_CORPUS_TARGET_TOTAL);
  const niches = input.niches || [];
  const nicheTargets = corpusTargetByNiche(niches.map((row) => row.niche), targetTotal);
  const platformTargets = corpusTargetByPlatform(targetTotal);
  const platforms = (input.platforms || ["tiktok", "instagram", "youtube"]) as PlatformKey[];
  const atlasByKey = new Map(
    ((input.patternAtlas?.by_segment || []) as AtlasSegment[])
      .map((row) => [`${text(row.niche)}__${text(row.platform)}`, row] as const),
  );

  const rows = niches.flatMap((nicheRow) => {
    const nicheTarget = num(nicheTargets[nicheRow.niche]);
    const segmentTargets = roundSegmentTargets(nicheTarget, platformTargets);
    return platforms.map((platform) => {
      const platformBrain = nicheRow.platform_brains?.[platform] || {};
      const atlas = atlasByKey.get(`${nicheRow.niche}__${platform}`) || {};
      const currentTotal = num(platformBrain.total_videos);
      const currentAnalyzed = num(platformBrain.analyzed_videos);
      const currentReady = num(platformBrain.generator_ready_patterns);
      const currentStable = num(atlas.stable_pattern_count);
      const totalTargetForSegment = num(segmentTargets[platform]);
      const activationTarget = clamp(Math.round(totalTargetForSegment * 0.45), 60, Math.max(60, totalTargetForSegment));
      const analyzedTarget = clamp(Math.round(totalTargetForSegment * 0.65), 30, Math.max(30, totalTargetForSegment));
      const readyTarget = totalTargetForSegment >= 200 ? 4 : totalTargetForSegment >= 100 ? 3 : 2;
      const stableTarget = totalTargetForSegment >= 200 ? 3 : totalTargetForSegment >= 100 ? 2 : 1;
      const totalGap = Math.max(0, totalTargetForSegment - currentTotal);
      const activationGap = Math.max(0, activationTarget - currentTotal);
      const analyzedGap = Math.max(0, analyzedTarget - currentAnalyzed);
      const readyGap = Math.max(0, readyTarget - currentReady);
      const stableGap = Math.max(0, stableTarget - currentStable);
      const status = segmentStatus({
        activationGap,
        analyzedGap,
        readyGap,
        stableGap,
        atlasStatus: text(atlas.status),
      });
      const gapScore = clamp(
        Math.min(34, activationGap / 8)
        + Math.min(26, analyzedGap / 5)
        + Math.min(20, readyGap * 6)
        + Math.min(20, stableGap * 7),
        0,
        100,
      );

      return {
        niche: nicheRow.niche,
        platform,
        status,
        gap_score: gapScore,
        current: {
          total_videos: currentTotal,
          analyzed_videos: currentAnalyzed,
          generator_ready_patterns: currentReady,
          stable_patterns: currentStable,
        },
        target: {
          total_videos: totalTargetForSegment,
          activation_total_videos: activationTarget,
          analyzed_videos: analyzedTarget,
          generator_ready_patterns: readyTarget,
          stable_patterns: stableTarget,
        },
        gap: {
          total_videos: totalGap,
          activation_total_videos: activationGap,
          analyzed_videos: analyzedGap,
          generator_ready_patterns: readyGap,
          stable_patterns: stableGap,
        },
        atlas_status: text(atlas.status),
        avg_stability_score: num(atlas.avg_stability_score),
        next_action: segmentNextAction({ status, totalGap, activationGap, analyzedGap, readyGap, stableGap }),
      };
    });
  })
    .sort((a, b) =>
      b.gap_score - a.gap_score
      || b.gap.stable_patterns - a.gap.stable_patterns
      || b.gap.generator_ready_patterns - a.gap.generator_ready_patterns
      || b.gap.analyzed_videos - a.gap.analyzed_videos
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    );

  return {
    summary: {
      total_segments: rows.length,
      stable: rows.filter((row) => row.status === "stable").length,
      grow_corpus: rows.filter((row) => row.status === "grow_corpus").length,
      analyze_more: rows.filter((row) => row.status === "analyze_more").length,
      build_patterns: rows.filter((row) => row.status === "build_patterns").length,
    },
    focus_segments: rows.slice(0, Math.max(4, input.limit || 8)),
    stable_segments: rows.filter((row) => row.status === "stable").slice(0, Math.max(3, Math.min(6, input.limit || 8))),
  };
}
