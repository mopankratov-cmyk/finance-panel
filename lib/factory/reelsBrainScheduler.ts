import { parseAutomationNiches, parseAutomationPlatforms } from "./reelsBrainAutomation";

export type ReelsBrainScheduledTask = {
  task: "bulk" | "analyze" | "daily" | "weekly";
  cadence_minutes: number;
  endpoint: string;
  method: "POST";
  payload: Record<string, unknown>;
  reason: string;
};

export function buildReelsBrainSchedulerPlan(input?: {
  niches?: string | null;
  platforms?: string | null;
  max_lanes?: unknown;
  limit?: unknown;
  max_provider_calls?: unknown;
  max_cost_units?: unknown;
}): {
  niches: string[];
  platforms: string[];
  tasks: ReelsBrainScheduledTask[];
} {
  const niches = parseAutomationNiches(input?.niches, 10);
  const platforms = parseAutomationPlatforms(input?.platforms).filter((platform) => platform !== "unknown");
  const platformParam = platforms.join(",");
  const nicheParam = niches.join(",");
  const limit = Math.max(5, Math.min(50, Number(input?.limit || 25)));

  return {
    niches,
    platforms,
    tasks: [
      {
        task: "bulk",
        cadence_minutes: 15,
        endpoint: "/api/factory/jobs/reels-brain-autopilot",
        method: "POST",
        reason: "autopilot supervisor picks collect vs analyze on the road to 10k",
        payload: {
          niches: nicheParam,
          platforms: platformParam,
          limit,
          target: 10000,
          max_backlog_before_analyze: 180,
          hours: 72,
        },
      },
      {
        task: "daily",
        cadence_minutes: 24 * 60,
        endpoint: "/api/factory/jobs/reels-brain-daily",
        method: "POST",
        reason: "light intake/analyze/pattern refresh",
        payload: {
          niches: nicheParam,
          platforms: platformParam,
          query_count: 2,
          source_limit: 18,
          analyze_limit: 6,
        },
      },
      {
        task: "analyze",
        cadence_minutes: 6 * 60,
        endpoint: "/api/factory/jobs/reels-brain-analyze-backlog",
        method: "POST",
        reason: "turn raw corpus into analyzed hooks and structures",
        payload: {
          niches: nicheParam,
          platforms: platformParam,
          max_lanes: 3,
          limit: 8,
          build_patterns: false,
        },
      },
      {
        task: "weekly",
        cadence_minutes: 7 * 24 * 60,
        endpoint: "/api/factory/jobs/reels-brain-weekly",
        method: "POST",
        reason: "provider bake-off and retrain pass",
        payload: {
          niches: nicheParam,
          platforms: platformParam,
          query_count: 4,
          source_limit: 24,
          analyze_limit: 12,
          persist_memory: true,
        },
      },
    ],
  };
}
