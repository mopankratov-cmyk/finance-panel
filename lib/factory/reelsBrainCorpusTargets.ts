import type { ReelsPlatform } from "./reelsBrain";

export const REELS_BRAIN_CORPUS_TARGET_TOTAL = 10_000;
export const REELS_BRAIN_DEFAULT_TARGET_NICHES = ["toys", "clothing", "cosmetics", "default"] as const;
type CorePlatform = Exclude<ReelsPlatform, "unknown">;

const PLATFORM_WEIGHTS: Record<CorePlatform, number> = {
  tiktok: 0.4,
  instagram: 0.35,
  youtube: 0.25,
};

const STAGE_DEFS = [
  { key: "stage_1", label: "Seed corpus", total_target: 300 },
  { key: "stage_2", label: "Learning baseline", total_target: 1_500 },
  { key: "stage_3", label: "Operator-grade brain", total_target: 4_000 },
  { key: "stage_4", label: "Full 10k corpus", total_target: REELS_BRAIN_CORPUS_TARGET_TOTAL },
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundTarget(total: number, weight: number) {
  return Math.round(total * weight);
}

export function corpusTargetByPlatform(totalTarget = REELS_BRAIN_CORPUS_TARGET_TOTAL): Record<CorePlatform, number> {
  const tiktok = roundTarget(totalTarget, PLATFORM_WEIGHTS.tiktok);
  const instagram = roundTarget(totalTarget, PLATFORM_WEIGHTS.instagram);
  const youtube = Math.max(0, totalTarget - tiktok - instagram);
  return { tiktok, instagram, youtube };
}

export function corpusTargetByNiche(niches: string[], totalTarget = REELS_BRAIN_CORPUS_TARGET_TOTAL): Record<string, number> {
  const clean = Array.from(new Set(niches.map((row) => String(row || "").trim()).filter(Boolean)));
  if (!clean.length) return {};
  const base = Math.floor(totalTarget / clean.length);
  let remainder = totalTarget - base * clean.length;
  return Object.fromEntries(clean.map((niche) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return [niche, base + extra];
  }));
}

export function corpusProgress(input: { current: number; target?: number }) {
  const target = Math.max(1, Number(input.target || REELS_BRAIN_CORPUS_TARGET_TOTAL));
  const current = Math.max(0, Number(input.current || 0));
  const gap = Math.max(0, target - current);
  const progress_pct = Math.round((current / target) * 1000) / 10;
  return {
    current,
    target,
    gap,
    progress_pct: clamp(progress_pct, 0, 100),
    complete: current >= target,
  };
}

export function corpusStage(currentTotal: number) {
  const current = Math.max(0, Number(currentTotal || 0));
  const currentStage = STAGE_DEFS.find((stage) => current < stage.total_target) || STAGE_DEFS[STAGE_DEFS.length - 1];
  const previousStages = STAGE_DEFS.filter((stage) => current >= stage.total_target);
  return {
    current_total: current,
    stage_key: currentStage.key,
    stage_label: currentStage.label,
    stage_target: currentStage.total_target,
    passed_stages: previousStages.map((stage) => stage.key),
    remaining_to_stage: Math.max(0, currentStage.total_target - current),
    roadmap: STAGE_DEFS.map((stage) => ({
      ...stage,
      reached: current >= stage.total_target,
      gap: Math.max(0, stage.total_target - current),
    })),
  };
}

export function corpusAutomationPressure(input: {
  mode: "daily" | "weekly";
  currentVideos?: number;
  targetVideos?: number;
}) {
  const target = Math.max(1, Number(input.targetVideos || 1));
  const current = Math.max(0, Number(input.currentVideos || 0));
  const ratio = current / target;

  if (input.mode === "weekly") {
    if (ratio < 0.1) return { query_count: 5, source_limit: 36, analyze_limit: 14, bake_off_limit: 32 };
    if (ratio < 0.25) return { query_count: 5, source_limit: 32, analyze_limit: 14, bake_off_limit: 28 };
    if (ratio < 0.5) return { query_count: 4, source_limit: 28, analyze_limit: 12, bake_off_limit: 26 };
    if (ratio < 0.8) return { query_count: 4, source_limit: 24, analyze_limit: 12, bake_off_limit: 24 };
    return { query_count: 3, source_limit: 20, analyze_limit: 10, bake_off_limit: 20 };
  }

  if (ratio < 0.1) return { query_count: 3, source_limit: 24, analyze_limit: 8, bake_off_limit: 20 };
  if (ratio < 0.25) return { query_count: 3, source_limit: 22, analyze_limit: 8, bake_off_limit: 18 };
  if (ratio < 0.5) return { query_count: 3, source_limit: 20, analyze_limit: 7, bake_off_limit: 18 };
  if (ratio < 0.8) return { query_count: 2, source_limit: 18, analyze_limit: 6, bake_off_limit: 16 };
  return { query_count: 2, source_limit: 14, analyze_limit: 5, bake_off_limit: 14 };
}

export function corpusExecutionPlan(input: {
  currentTotal: number;
  targetTotal?: number;
  niches: Array<{ niche: string; current: number; target: number }>;
  platforms: Array<{ platform: CorePlatform; current: number; target: number }>;
  horizonDays?: number;
}) {
  const target = Math.max(1, Number(input.targetTotal || REELS_BRAIN_CORPUS_TARGET_TOTAL));
  const current = Math.max(0, Number(input.currentTotal || 0));
  const gap = Math.max(0, target - current);
  const horizonDays = clamp(Number(input.horizonDays || 42), 7, 180);
  const dailyRequired = Math.ceil(gap / horizonDays);
  const weeklyRequired = dailyRequired * 7;

  return {
    horizon_days: horizonDays,
    daily_required: dailyRequired,
    weekly_required: weeklyRequired,
    on_track: gap <= 0,
    by_platform: input.platforms.map((row) => {
      const progress = corpusProgress({ current: row.current, target: row.target });
      return {
        platform: row.platform,
        ...progress,
        daily_required: Math.ceil(progress.gap / horizonDays),
        weekly_required: Math.ceil(progress.gap / Math.max(1, Math.floor(horizonDays / 7))),
      };
    }),
    by_niche: input.niches.map((row) => {
      const progress = corpusProgress({ current: row.current, target: row.target });
      return {
        niche: row.niche,
        ...progress,
        daily_required: Math.ceil(progress.gap / horizonDays),
        weekly_required: Math.ceil(progress.gap / Math.max(1, Math.floor(horizonDays / 7))),
      };
    }),
  };
}
