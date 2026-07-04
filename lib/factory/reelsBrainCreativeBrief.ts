import { buildPatternTrustSummary, type ReelsBrainPatternTrust } from "./reelsBrainTrust";
import { corpusQualityGate } from "./reelsBrainPlaybook";

export type CreativeBriefPattern = {
  pattern_id?: string;
  hook_type?: string;
  structure_type?: string;
  retention_mechanism?: string;
  frequency?: number;
  strength_score?: number;
  quality_label?: string;
  quality_score?: number;
  relevance_score?: number;
};

export type CreativeBriefAntiPattern = {
  label?: string;
  severity?: string;
};

export type CreativeBriefBrain = {
  total_videos?: number;
  analyzed_videos?: number;
  patterns?: CreativeBriefPattern[];
  generator_ready_patterns?: CreativeBriefPattern[];
  anti_patterns?: CreativeBriefAntiPattern[];
  quality_summary?: {
    avg_relevance_score?: number;
  };
};

export interface CreativeBriefTrustDecision {
  selected_scope: "platform" | "meta";
  selected_platform: string;
  trust: ReelsBrainPatternTrust;
  fallback_trust: ReelsBrainPatternTrust | null;
  allow_primary_use: boolean;
  recommended_mode: "primary" | "control_only" | "research_only";
  reasons: string[];
}

function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBrain(value: unknown): CreativeBriefBrain | null {
  return value && typeof value === "object" && Array.isArray((value as CreativeBriefBrain).patterns)
    ? value as CreativeBriefBrain
    : null;
}

function metaLikeGate(platformTrusts: ReelsBrainPatternTrust[]) {
  const scale = Math.max(1, platformTrusts.length);
  return {
    min_videos: 20 * scale,
    min_analyzed: 8 * scale,
    min_patterns: 3 * scale,
    min_winners: Math.max(1, scale - 1),
  };
}

export function selectCreativeBriefBrainWithTrust(input: {
  playbook: Record<string, unknown>;
  platform: string;
}): CreativeBriefTrustDecision {
  const platform = String(input.platform || "").trim().toLowerCase();
  const root = (input.playbook.reels_brain_patterns || {}) as Record<string, unknown>;
  const platformBrains = (root.platform_brains || {}) as Record<string, unknown>;
  const exactBrain = platform ? asBrain(platformBrains[platform]) : null;
  const metaBrain = asBrain(root.meta_brain) || asBrain(root);

  const platformGate = platform ? corpusQualityGate(input.playbook, platform as "tiktok" | "instagram" | "youtube") : null;
  const platformTrust = exactBrain
    ? buildPatternTrustSummary(exactBrain as any, {
        platform: (platform || "tiktok") as any,
        ready:
          num(exactBrain.total_videos) >= num(platformGate?.min_videos)
          && num(exactBrain.analyzed_videos) >= num(platformGate?.min_analyzed)
          && (exactBrain.patterns?.length || 0) >= num(platformGate?.min_patterns),
        score: 0,
        videos: num(exactBrain.total_videos),
        analyzed: num(exactBrain.analyzed_videos),
        patterns: exactBrain.patterns?.length || 0,
        winners: 0,
        gates: platformGate || undefined,
        missing: [],
      } as any, platformGate || undefined)
    : null;

  const allPlatformTrusts = Object.entries(platformBrains)
    .map(([key, value]) => {
      const brain = asBrain(value);
      if (!brain) return null;
      const gate = corpusQualityGate(input.playbook, key as "tiktok" | "instagram" | "youtube");
      return buildPatternTrustSummary(brain as any, {
        platform: key as any,
        ready:
          num(brain.total_videos) >= num(gate.min_videos)
          && num(brain.analyzed_videos) >= num(gate.min_analyzed)
          && (brain.patterns?.length || 0) >= num(gate.min_patterns),
        score: 0,
        videos: num(brain.total_videos),
        analyzed: num(brain.analyzed_videos),
        patterns: brain.patterns?.length || 0,
        winners: 0,
        gates: gate,
        missing: [],
      } as any, gate);
    })
    .filter(Boolean) as ReelsBrainPatternTrust[];

  const fallbackTrust = metaBrain
    ? buildPatternTrustSummary(metaBrain as any, {
        platform: "tiktok" as any,
        ready: allPlatformTrusts.some((item) => item.status === "ready") || allPlatformTrusts.filter((item) => item.status !== "weak").length >= 2,
        score: 0,
        videos: num(metaBrain.total_videos),
        analyzed: num(metaBrain.analyzed_videos),
        patterns: metaBrain.patterns?.length || 0,
        winners: 0,
        gates: metaLikeGate(allPlatformTrusts),
        missing: [],
      } as any, metaLikeGate(allPlatformTrusts))
    : null;

  const usePlatform = !!platformTrust && (
    platformTrust.status === "ready"
    || (!fallbackTrust || platformTrust.score >= fallbackTrust.score + 8)
  );
  const chosenTrust = (usePlatform ? platformTrust : fallbackTrust) || platformTrust || fallbackTrust || buildPatternTrustSummary(null, null, null);
  const selected_scope: "platform" | "meta" = usePlatform ? "platform" : "meta";
  const reasons: string[] = [];

  if (platform && platformTrust) {
    reasons.push(`${platform} trust ${platformTrust.score}% · ${platformTrust.status}`);
  }
  if (fallbackTrust) {
    reasons.push(`meta trust ${fallbackTrust.score}% · ${fallbackTrust.status}`);
  }
  if (usePlatform) reasons.push("используем platform-specific brain");
  else if (platform) reasons.push("platform brain ещё слабый, поэтому даём более безопасный fallback");

  const allowPrimary = chosenTrust.status === "ready" && chosenTrust.confidence !== "low";
  const recommendedMode: CreativeBriefTrustDecision["recommended_mode"] = allowPrimary
    ? "primary"
    : chosenTrust.status === "warming"
      ? "control_only"
      : "research_only";

  return {
    selected_scope,
    selected_platform: platform,
    trust: chosenTrust,
    fallback_trust: fallbackTrust,
    allow_primary_use: allowPrimary,
    recommended_mode: recommendedMode,
    reasons,
  };
}
