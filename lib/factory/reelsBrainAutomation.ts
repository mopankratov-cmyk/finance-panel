import type { ReelsPlatform } from "./reelsBrain";
import { corpusAutomationPressure, corpusTargetByPlatform } from "./reelsBrainCorpusTargets";
import {
  nextRecommendedSourceQueries,
  normalizeShortPlatform,
  sourceRelearnPolicy,
} from "./reelsBrainPlaybook";

export type ReelsBrainAutomationMode = "daily" | "weekly";

export interface ReelsBrainAutomationPlan {
  mode: ReelsBrainAutomationMode;
  niche: string;
  platform: ReelsPlatform;
  queries: string[];
  query_count: number;
  source_limit: number;
  analyze_limit: number;
  bake_off_limit: number;
  auto_relearn: boolean;
  corpus_target: number;
  current_videos: number;
  progress_pct: number;
}

export interface ReelsBrainCorpusGrowthLane {
  niche: string;
  platform: Exclude<ReelsPlatform, "unknown">;
  current_videos: number;
  corpus_target: number;
  gap: number;
  progress_pct: number;
}

export const DEFAULT_AUTOMATION_NICHES = ["toys", "clothing", "cosmetics", "default"];
export const DEFAULT_AUTOMATION_PLATFORMS: ReelsPlatform[] = ["tiktok", "instagram", "youtube"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseAutomationNiches(value: string | null | undefined, max = 6): string[] {
  if (!value) return DEFAULT_AUTOMATION_NICHES.slice(0, max);
  const rows = value
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
  return Array.from(new Set(rows)).slice(0, max);
}

export function parseAutomationPlatforms(value: string | null | undefined): ReelsPlatform[] {
  if (!value) return [...DEFAULT_AUTOMATION_PLATFORMS];
  const rows = value
    .split(",")
    .map((row) => normalizeShortPlatform(row))
    .filter((row, index, list) => list.indexOf(row) === index);
  return rows.length ? rows : [...DEFAULT_AUTOMATION_PLATFORMS];
}

export function buildAutomationPlan(input: {
  mode: ReelsBrainAutomationMode;
  playbook: unknown;
  niche: string;
  platform: ReelsPlatform;
  query_count?: number;
  source_limit?: number;
  analyze_limit?: number;
  current_videos?: number;
  target_videos?: number;
}): ReelsBrainAutomationPlan {
  const policy = sourceRelearnPolicy(input.playbook, input.platform);
  const corePlatform = input.platform === "instagram" || input.platform === "youtube" ? input.platform : "tiktok";
  const corpusTarget = Math.max(1, Number(input.target_videos || corpusTargetByPlatform()[corePlatform]));
  const currentVideos = Math.max(0, Number(input.current_videos || 0));
  const pressure = corpusAutomationPressure({
    mode: input.mode,
    currentVideos,
    targetVideos: corpusTarget,
  });
  const defaultQueryCount = pressure.query_count;
  const queryCount = clamp(Number(input.query_count || defaultQueryCount), 1, 6);
  const recommended = nextRecommendedSourceQueries(input.playbook, input.niche, input.platform, input.niche);
  const queries = recommended.slice(0, queryCount);
  const defaultSourceLimit = pressure.source_limit;
  const defaultAnalyzeLimit = pressure.analyze_limit;

  return {
    mode: input.mode,
    niche: input.niche,
    platform: input.platform,
    queries,
    query_count: queryCount,
    source_limit: clamp(Number(input.source_limit || defaultSourceLimit), 1, 50),
    analyze_limit: clamp(Number(input.analyze_limit || defaultAnalyzeLimit), 0, 25),
    bake_off_limit: clamp(
      Number(pressure.bake_off_limit || (input.mode === "weekly" ? Math.max(policy.bake_off_limit, queryCount * 6) : Math.max(policy.bake_off_limit, queryCount * 4))),
      5,
      40,
    ),
    auto_relearn: true,
    corpus_target: corpusTarget,
    current_videos: currentVideos,
    progress_pct: Math.round((currentVideos / corpusTarget) * 1000) / 10,
  };
}

export function buildCorpusGrowthQueue(input: {
  lanes: ReelsBrainCorpusGrowthLane[];
  max_lanes?: number;
}): ReelsBrainCorpusGrowthLane[] {
  const maxLanes = clamp(Number(input.max_lanes || 3), 1, 12);
  return [...input.lanes]
    .filter((lane) => lane.gap > 0)
    .sort((a, b) =>
      a.progress_pct - b.progress_pct
      || b.gap - a.gap
      || a.niche.localeCompare(b.niche)
      || a.platform.localeCompare(b.platform),
    )
    .slice(0, maxLanes);
}

export function summarizeLoopResult(result: unknown): {
  found: number;
  inserted: number;
  relevant: number;
  analyzed: number;
  bake_offs: number;
  retries: number;
  errors: string[];
} {
  const row = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const sourceRuns = Array.isArray(row.source_runs) ? row.source_runs as Record<string, unknown>[] : [];
  const found = sourceRuns.reduce((sum, run) => sum + Math.max(0, Number(run.found || 0)), 0);
  const inserted = sourceRuns.reduce((sum, run) => sum + Math.max(0, Number(run.inserted || 0)), 0);
  const relevant = sourceRuns.reduce((sum, run) => sum + Math.max(0, Number(run.relevant || 0)), 0);
  const analyzed = Math.max(0, Number((row.analyze && typeof row.analyze === "object" ? (row.analyze as Record<string, unknown>).analyzed : 0) || 0));
  const errors = [
    typeof row.error === "string" ? row.error : "",
    ...sourceRuns.map((run) => (typeof run.error === "string" ? run.error : "")).filter(Boolean),
  ].filter(Boolean);

  return {
    found,
    inserted,
    relevant,
    analyzed,
    bake_offs: Array.isArray(row.bake_offs) ? row.bake_offs.length : 0,
    retries: Array.isArray(row.retries) ? row.retries.length : 0,
    errors,
  };
}
