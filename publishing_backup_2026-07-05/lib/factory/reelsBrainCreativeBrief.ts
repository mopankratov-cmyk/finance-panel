import {
  buildOutcomeSignal,
  buildPatternTrustSummary,
  type ReelsBrainAudioCoverageInput,
  type ReelsBrainPatternTrust,
} from "./reelsBrainTrust";
import { corpusQualityGate } from "./reelsBrainPlaybook";
import type { ReelsBrainMetricRow } from "./reelsBrainOperatingSystem";
import type { ReelsPatternRebuildContext } from "./reelsBrainPatterns";

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

type CreativeBriefCorpusRow = {
  platform?: string | null;
  analyzed?: boolean | null;
  analyzed_full?: unknown;
};

export interface CreativeBriefTrustDecision {
  selected_scope: "platform" | "meta";
  selected_platform: string;
  trust: ReelsBrainPatternTrust;
  fallback_trust: ReelsBrainPatternTrust | null;
  allow_primary_use: boolean;
  recommended_mode: "primary" | "control_only" | "research_only";
  reasons: string[];
  rebuild_context: ReelsPatternRebuildContext | null;
  rebuild_alignment: {
    status: "aligned" | "partial" | "mismatch" | "unknown";
    score: number;
    reasons: string[];
  };
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

function asRebuildContext(value: unknown): ReelsPatternRebuildContext | null {
  return value && typeof value === "object"
    ? value as ReelsPatternRebuildContext
    : null;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readAudioSeed(value: unknown) {
  const analyzedFull = rec(value);
  const reelsSeed = rec(analyzedFull.reels_seed);
  const pipeline = rec(reelsSeed.pipeline);
  const transcript = typeof reelsSeed.transcript === "string" ? reelsSeed.transcript.trim() : "";
  const audioFeatures = rec(reelsSeed.audio_features);
  return {
    transcript,
    transcript_status: String(pipeline.transcript_status || "").trim(),
    audio_features: audioFeatures,
  };
}

function normalizePlatform(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw.includes("inst") || raw.includes("reels")) return "instagram";
  if (raw.includes("you") || raw.includes("short")) return "youtube";
  if (raw.includes("tik")) return "tiktok";
  return raw === "tiktok" || raw === "instagram" || raw === "youtube" ? raw : "unknown";
}

function buildAudioCoverage(rows: CreativeBriefCorpusRow[], platform: string | null = null): ReelsBrainAudioCoverageInput | null {
  const filtered = platform
    ? rows.filter((row) => normalizePlatform(row.platform) === platform)
    : rows;
  if (!filtered.length) return null;

  let analyzedVideos = 0;
  let withAudio = 0;
  let withTranscript = 0;
  let pauseMapReady = 0;
  let pacingReady = 0;
  let beatHintReady = 0;

  for (const row of filtered) {
    if (row.analyzed) analyzedVideos += 1;
    const seed = readAudioSeed(row.analyzed_full);
    const hasAudio = Object.keys(seed.audio_features).length > 0;
    const hasTranscript = seed.transcript.length > 20 || seed.transcript_status === "transcript_ready";
    if (hasAudio) {
      withAudio += 1;
      if (seed.audio_features.pause_count != null) pauseMapReady += 1;
      if (String(seed.audio_features.pacing_tier || "").trim()) pacingReady += 1;
      if (String(seed.audio_features.beat_density_hint || "").trim()) beatHintReady += 1;
    }
    if (hasTranscript) withTranscript += 1;
  }

  return {
    corpus_videos: filtered.length,
    analyzed_videos: analyzedVideos,
    with_audio: withAudio,
    with_transcript: withTranscript,
    pause_map_ready: pauseMapReady,
    pacing_ready: pacingReady,
    beat_hint_ready: beatHintReady,
  };
}

function buildRebuildAlignment(input: {
  rebuildContext: ReelsPatternRebuildContext | null;
  platform: string;
  selectedScope: "platform" | "meta";
}) {
  const rebuild = input.rebuildContext;
  if (!rebuild) {
    return {
      status: "unknown" as const,
      score: 0,
      reasons: ["контекст последней пересборки памяти не сохранён"],
    };
  }

  let score = 0;
  const reasons: string[] = [];
  const focusPlatform = String(rebuild.focus_platform || "").trim().toLowerCase();
  const executionMode = String(rebuild.execution_mode || "").trim().toLowerCase();

  if (input.platform && focusPlatform && focusPlatform === input.platform) {
    score += 24;
    reasons.push(`память пересобиралась с platform focus на ${input.platform}`);
  } else if (input.platform && focusPlatform && focusPlatform !== input.platform) {
    score -= 10;
    reasons.push(`последняя пересборка была смещена под ${focusPlatform}, а не под ${input.platform}`);
  } else if (input.selectedScope === "meta" && !focusPlatform) {
    score += 8;
    reasons.push("последняя пересборка была meta-level без жёсткого platform bias");
  }

  if (rebuild.output_ready_biased) {
    score += 10;
    reasons.push("память смещена в output-ready режим");
  }
  if (rebuild.brief_bundle_biased || executionMode === "brief_bundle_completion") {
    score += 14;
    reasons.push("пересборка была заточена под brief bundle");
  }
  if (rebuild.ship_ready_biased || executionMode === "ship_ready_generation") {
    score += 12;
    reasons.push("пересборка была заточена под ship-ready решения");
  }
  if (rebuild.high_trust_generation_biased || executionMode === "high_trust_generation") {
    score += 14;
    reasons.push("пересборка была заточена под high-trust generation");
  }
  if (rebuild.exact_proof_biased) {
    score += 8;
    reasons.push("в памяти есть bias на exact-proof сигналы");
  }
  if (input.selectedScope === "meta" && rebuild.platform_biased && !focusPlatform) {
    score -= 4;
    reasons.push("meta fallback опирается на память с platform bias");
  }

  const status = score >= 28
    ? "aligned"
    : score >= 12
      ? "partial"
      : score < 0
        ? "mismatch"
        : "unknown";

  return {
    status,
    score,
    reasons: reasons.length ? reasons : ["контекст пересборки не даёт сильного сигнала для этого brief"],
  };
}

export function selectCreativeBriefBrainWithTrust(input: {
  playbook: Record<string, unknown>;
  platform: string;
  feedbackRows?: ReelsBrainMetricRow[];
  corpusRows?: CreativeBriefCorpusRow[];
}): CreativeBriefTrustDecision {
  const platform = String(input.platform || "").trim().toLowerCase();
  const root = (input.playbook.reels_brain_patterns || {}) as Record<string, unknown>;
  const platformBrains = (root.platform_brains || {}) as Record<string, unknown>;
  const rebuildContext = asRebuildContext(root.rebuild_context);
  const exactBrain = platform ? asBrain(platformBrains[platform]) : null;
  const metaBrain = asBrain(root.meta_brain) || asBrain(root);
  const platformAudio = platform ? buildAudioCoverage(input.corpusRows || [], platform) : null;
  const metaAudio = buildAudioCoverage(input.corpusRows || [], null);

  const platformGate = platform ? corpusQualityGate(input.playbook, platform as "tiktok" | "instagram" | "youtube") : null;
  const platformOutcome = platform ? buildOutcomeSignal(input.feedbackRows || [], platform as "tiktok" | "instagram" | "youtube") : null;
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
      } as any, platformGate || undefined, platformOutcome, platformAudio)
    : null;

  const allPlatformTrusts = Object.entries(platformBrains)
    .map(([key, value]) => {
      const brain = asBrain(value);
      if (!brain) return null;
      const gate = corpusQualityGate(input.playbook, key as "tiktok" | "instagram" | "youtube");
      const outcome = buildOutcomeSignal(input.feedbackRows || [], key as "tiktok" | "instagram" | "youtube");
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
      } as any, gate, outcome, buildAudioCoverage(input.corpusRows || [], key));
    })
    .filter(Boolean) as ReelsBrainPatternTrust[];

  const metaOutcome = buildOutcomeSignal(input.feedbackRows || [], "all");
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
      } as any, metaLikeGate(allPlatformTrusts), metaOutcome, metaAudio)
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

  const rebuildAlignment = buildRebuildAlignment({
    rebuildContext,
    platform,
    selectedScope: selected_scope,
  });
  if (rebuildAlignment.status !== "unknown") {
    reasons.push(`memory ${rebuildAlignment.status} ${rebuildAlignment.score}`);
  }
  if (chosenTrust.audio_support) {
    reasons.push(`audio ${chosenTrust.audio_support.status} ${chosenTrust.audio_support.score}% · transcript ${chosenTrust.audio_support.with_transcript_rate}%`);
  }

  const allowPrimary = chosenTrust.status === "ready"
    && chosenTrust.confidence !== "low"
    && chosenTrust.audio_support?.status !== "weak";
  const recommendedMode: CreativeBriefTrustDecision["recommended_mode"] = allowPrimary
    ? "primary"
    : chosenTrust.status === "warming"
      || chosenTrust.audio_support?.status === "warming"
      || (chosenTrust.status === "ready" && chosenTrust.audio_support?.status === "weak")
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
    rebuild_context: rebuildContext,
    rebuild_alignment: rebuildAlignment,
  };
}
