export type ReelsBrainPriorityInput = {
  id?: number | null;
  viralityScore?: number | null;
  views?: number | null;
  createdAt?: string | null;
  audioStatus?: string | null;
  transcriptStatus?: string | null;
  hasDirectMedia?: boolean;
  hasPageFallback?: boolean;
};

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hoursSince(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null;
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
}

export function stableShardMatch(id: number | null | undefined, shardIndex: number, shardCount: number): boolean {
  if (!Number.isFinite(id) || shardCount <= 1) return true;
  return Math.abs(Number(id)) % shardCount === shardIndex;
}

export function stableBucketMatch(value: string, shardIndex: number, shardCount: number): boolean {
  if (shardCount <= 1) return true;
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % shardCount === shardIndex;
}

export function parseShardConfig(input: { shardIndex?: unknown; shardCount?: unknown }) {
  const rawCount = Math.max(1, Math.min(16, Math.round(toNumber(input.shardCount) || 1)));
  const rawIndex = Math.max(0, Math.min(rawCount - 1, Math.round(toNumber(input.shardIndex) || 0)));
  return { shardIndex: rawIndex, shardCount: rawCount };
}

export function scoreAudioCandidate(input: ReelsBrainPriorityInput): number {
  const virality = toNumber(input.viralityScore) || 0;
  const views = toNumber(input.views) || 0;
  const hours = hoursSince(input.createdAt);
  const recencyBoost = hours == null ? 0 : Math.max(0, 48 - Math.min(48, hours)) * 0.35;
  const audioStatus = String(input.audioStatus || "").trim().toLowerCase();
  const transcriptStatus = String(input.transcriptStatus || "").trim().toLowerCase();

  let score = virality * 8 + Math.log10(Math.max(views, 1)) * 12 + recencyBoost;
  if (input.hasDirectMedia) score += 18;
  if (input.hasPageFallback) score += 8;
  if (audioStatus === "audio_pending") score += 14;
  if (audioStatus === "audio_failed") score += 6;
  if (transcriptStatus === "transcript_pending") score += 10;
  if (transcriptStatus === "transcript_failed") score += 4;
  return Math.round(score * 10) / 10;
}

export function scoreMediaCandidate(input: ReelsBrainPriorityInput): number {
  const virality = toNumber(input.viralityScore) || 0;
  const views = toNumber(input.views) || 0;
  const hours = hoursSince(input.createdAt);
  const recencyBoost = hours == null ? 0 : Math.max(0, 72 - Math.min(72, hours)) * 0.25;
  let score = virality * 8 + Math.log10(Math.max(views, 1)) * 10 + recencyBoost;
  if (input.hasPageFallback) score += 14;
  return Math.round(score * 10) / 10;
}
