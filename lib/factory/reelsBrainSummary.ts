import { normalizeTargetPlatform } from "./reelsBrainPlaybook";
import type { ReelsPlatform } from "./reelsBrain";

export interface ReelsBrainSummaryVideoRow {
  platform: string | null;
  virality_score: number | null;
  analyzed: boolean;
  hook_text: string | null;
  caption?: string | null;
  format_detected: string | null;
  sound_title: string | null;
  source_orbit_id: string | null;
}

export interface ReelsBrainSummaryWinnerRow {
  winner_learnings?: Record<string, unknown> | null;
}

export interface ReelsBrainPlatformSummary {
  platform: ReelsPlatform;
  videos: number;
  analyzed: number;
  avg_score: number;
  top_hooks: string[];
  top_formats: string[];
  top_sounds: string[];
  winners: number;
  top_winner_hooks: string[];
  source_providers: { provider: string; count: number }[];
  pattern_count: number;
}

const PLATFORMS: ReelsPlatform[] = ["tiktok", "instagram", "youtube"];
const SYNTHETIC_WINNER_TARGETS: Partial<Record<ReelsPlatform, number>> = {
  tiktok: 2,
  instagram: 2,
  youtube: 1,
};

function topKeys(map: Map<string, number>, limit: number): string[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

function topProviderCounts(map: Map<string, number>, limit: number): { provider: string; count: number }[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([provider, count]) => ({ provider, count }));
}

function providerFromSource(source: string | null | undefined): string {
  const raw = String(source || "").trim();
  if (!raw) return "unknown";
  return raw.split(":")[0] || "unknown";
}

function mergeWinnerRows(
  videos: ReelsBrainSummaryVideoRow[],
  winners: ReelsBrainSummaryWinnerRow[],
): ReelsBrainSummaryWinnerRow[] {
  const merged = [...winners];
  for (const platform of PLATFORMS) {
    const target = Number(SYNTHETIC_WINNER_TARGETS[platform] || 0);
    const existing = winners.filter((row) => normalizeTargetPlatform(row.winner_learnings?.target_platform) === platform);
    if (existing.length >= target) continue;
    const usedHooks = new Set(
      existing
        .map((row) => String(row.winner_learnings?.hook || "").trim().toLowerCase())
        .filter(Boolean),
    );
    const candidates = videos
      .filter((row) => normalizeTargetPlatform(row.platform) === platform)
      .filter((row) => row.analyzed)
      .filter((row) => String(row.hook_text || row.caption || "").trim())
      .sort((a, b) => (Number(b.virality_score) || 0) - (Number(a.virality_score) || 0));
    for (const row of candidates) {
      if (existing.length >= target) break;
      const hook = String(row.hook_text || row.caption || "").trim();
      const hookKey = hook.toLowerCase();
      if (!hook || usedHooks.has(hookKey)) continue;
      existing.push({
        winner_learnings: {
          hook,
          target_platform: platform,
          format: row.format_detected || null,
          sound_title: row.sound_title || null,
          virality_score: row.virality_score ?? null,
          source: "viral_seed",
        },
      });
      usedHooks.add(hookKey);
    }
    merged.push(...existing.slice(winners.filter((row) => normalizeTargetPlatform(row.winner_learnings?.target_platform) === platform).length));
  }
  return merged;
}

export function buildReelsBrainPlatformSummary(input: {
  videos: ReelsBrainSummaryVideoRow[];
  winners?: ReelsBrainSummaryWinnerRow[];
  patternCounts?: Partial<Record<ReelsPlatform, number>>;
}): ReelsBrainPlatformSummary[] {
  const winners = mergeWinnerRows(input.videos || [], input.winners || []);
  const patternCounts = input.patternCounts || {};

  return PLATFORMS.map((platform) => {
    const platformVideos = input.videos.filter((row) => normalizeTargetPlatform(row.platform) === platform);
    const platformWinners = winners.filter((row) => normalizeTargetPlatform(row.winner_learnings?.target_platform) === platform);
    const hookCounts = new Map<string, number>();
    const formatCounts = new Map<string, number>();
    const soundCounts = new Map<string, number>();
    const providerCounts = new Map<string, number>();
    const winnerHookCounts = new Map<string, number>();

    let analyzed = 0;
    let scoreTotal = 0;
    let scored = 0;

    for (const row of platformVideos) {
      if (row.analyzed) analyzed += 1;
      if (typeof row.virality_score === "number" && Number.isFinite(row.virality_score)) {
        scoreTotal += row.virality_score;
        scored += 1;
      }
      const hook = String(row.hook_text || "").trim();
      if (hook) hookCounts.set(hook, (hookCounts.get(hook) || 0) + 1);
      const format = String(row.format_detected || "").trim();
      if (format) formatCounts.set(format, (formatCounts.get(format) || 0) + 1);
      const sound = String(row.sound_title || "").trim();
      if (sound) soundCounts.set(sound, (soundCounts.get(sound) || 0) + 1);
      const provider = providerFromSource(row.source_orbit_id);
      providerCounts.set(provider, (providerCounts.get(provider) || 0) + 1);
    }

    for (const row of platformWinners) {
      const hook = String(row.winner_learnings?.hook || "").trim();
      if (hook) winnerHookCounts.set(hook, (winnerHookCounts.get(hook) || 0) + 1);
    }

    return {
      platform,
      videos: platformVideos.length,
      analyzed,
      avg_score: scored ? Math.round(scoreTotal / scored * 10) / 10 : 0,
      top_hooks: topKeys(hookCounts, 5),
      top_formats: topKeys(formatCounts, 5),
      top_sounds: topKeys(soundCounts, 5),
      winners: platformWinners.length,
      top_winner_hooks: topKeys(winnerHookCounts, 5),
      source_providers: topProviderCounts(providerCounts, 5),
      pattern_count: Number(patternCounts[platform] || 0),
    };
  });
}
