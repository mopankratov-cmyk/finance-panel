import type { ReelsPlatform } from "./reelsBrain";
import {
  type CrossPlatformPattern,
  type ReelsPatternMemory,
  type ReelsPatternMemoryBundle,
  type ReelsPatternRebuildContext,
  labelReelsHookType,
  labelReelsRetentionMechanism,
  labelReelsStructureType,
} from "./reelsBrainPatterns";
import type { ReelsBrainProvider } from "./reelsBrainSources";

export interface SelectedReelsBrain {
  platform: ReelsPlatform;
  requested_platform: ReelsPlatform;
  brain: ReelsPatternMemory | null;
  meta_brain: ReelsPatternMemory | null;
  cross_platform_patterns: CrossPlatformPattern[];
  rebuild_context: ReelsPatternRebuildContext | null;
}

export interface ReelsBrainSourceChoice {
  provider: ReelsBrainProvider;
  updated_at: string;
  source: string;
  runs?: number;
  found?: number;
  valid?: number;
  relevant?: number;
  avg_score?: number;
}

export interface ReelsBrainSourceMemory {
  preferred_by_platform: Partial<Record<"tiktok" | "instagram" | "youtube", ReelsBrainSourceChoice>>;
}

export interface ReelsBrainSourceHistoryEntry extends ReelsBrainSourceChoice {
  platform: "tiktok" | "instagram" | "youtube";
}

export interface ReelsBrainRelearnPolicy {
  min_found: number;
  min_relevant: number;
  min_inserted: number;
  stale_days: number;
  bake_off_limit: number;
  retry_limit: number;
}

export interface ReelsBrainCorpusQualityGate {
  min_videos: number;
  min_analyzed: number;
  min_patterns: number;
  min_winners: number;
}

export interface ReelsBrainTrainingReadiness {
  platform: "tiktok" | "instagram" | "youtube";
  ready: boolean;
  score: number;
  videos: number;
  analyzed: number;
  patterns: number;
  winners: number;
  gates: ReelsBrainCorpusQualityGate;
  missing: string[];
}

export interface ReelsBrainIncident {
  id: string;
  platform: "tiktok" | "instagram" | "youtube";
  severity: "info" | "watch" | "critical";
  kind: "brain_not_ready" | "provider_stale" | "provider_drift" | "low_yield" | "empty_intake" | "relearn_triggered";
  message: string;
  created_at: string;
  niche?: string;
  provider?: string;
  query?: string;
}

export interface ReelsBrainQueryStat {
  query: string;
  platform: "tiktok" | "instagram" | "youtube";
  runs: number;
  found: number;
  relevant: number;
  inserted: number;
  score: number;
  updated_at: string;
  low_yield_runs?: number;
  empty_runs?: number;
  suppressed_until?: string;
}

export interface ReelsBrainAlertSummary {
  total: number;
  critical: number;
  watch: number;
  info: number;
  by_kind: Record<string, number>;
}

export interface ReelsBrainAutomationRunHistoryEntry {
  id: string;
  mode: "daily" | "weekly" | "growth" | "bulk" | "learning" | "analyze";
  strategy?: string;
  created_at: string;
  niche?: string;
  platforms: ("tiktok" | "instagram" | "youtube")[];
  ok: boolean;
  found: number;
  inserted: number;
  analyzed: number;
  relevant: number;
  retries: number;
  errors: number;
  best_provider?: string | null;
  cost_units?: number;
  pattern_gain_proxy?: number;
  high_trust_gain_proxy?: number;
  estimated_spend_usd?: number;
  actual_spend_usd?: number | null;
  spend_source?: "estimated" | "actual";
}

const SHORT_PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
const DEFAULT_RELEARN_POLICIES: Record<(typeof SHORT_PLATFORMS)[number], ReelsBrainRelearnPolicy> = {
  tiktok: { min_found: 6, min_relevant: 3, min_inserted: 2, stale_days: 5, bake_off_limit: 20, retry_limit: 1 },
  instagram: { min_found: 5, min_relevant: 3, min_inserted: 2, stale_days: 7, bake_off_limit: 18, retry_limit: 1 },
  youtube: { min_found: 4, min_relevant: 2, min_inserted: 1, stale_days: 7, bake_off_limit: 15, retry_limit: 1 },
};
const DEFAULT_QUALITY_GATES: Record<(typeof SHORT_PLATFORMS)[number], ReelsBrainCorpusQualityGate> = {
  tiktok: { min_videos: 40, min_analyzed: 16, min_patterns: 6, min_winners: 2 },
  instagram: { min_videos: 30, min_analyzed: 12, min_patterns: 4, min_winners: 2 },
  youtube: { min_videos: 24, min_analyzed: 10, min_patterns: 4, min_winners: 1 },
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asMemory(value: unknown): ReelsPatternMemory | null {
  const row = rec(value);
  if (!row.patterns || !Array.isArray(row.patterns)) return null;
  return row as unknown as ReelsPatternMemory;
}

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (typeof row === "string") return row.trim();
      const recRow = rec(row);
      return String(
        recRow.text
        || recRow.hook
        || recRow.name
        || recRow.title
        || recRow.summary
        || recRow.pattern
        || "",
      ).trim();
    })
    .filter(Boolean);
}

function keywordish(value: string): string {
  return value
    .replace(/[|,:;.!?()[\]{}"'`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function dedupeLoose(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = keywordish(value).toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(keywordish(value));
  }
  return out;
}

export function normalizeShortPlatform(value: unknown): "tiktok" | "instagram" | "youtube" {
  const platform = normalizeTargetPlatform(value);
  return platform === "instagram" || platform === "youtube" ? platform : "tiktok";
}

function sourceMemory(playbook: unknown): ReelsBrainSourceMemory | null {
  const pb = rec(playbook);
  const root = rec(pb.reels_brain_sources);
  const preferred = rec(root.preferred_by_platform);
  const out: ReelsBrainSourceMemory = { preferred_by_platform: {} };
  for (const platform of ["tiktok", "instagram", "youtube"] as const) {
    const row = rec(preferred[platform]);
    const provider = String(row.provider || "").trim().toLowerCase();
    if (!provider) continue;
    out.preferred_by_platform[platform] = {
      provider: provider as ReelsBrainProvider,
      updated_at: String(row.updated_at || ""),
      source: String(row.source || "unknown"),
      runs: typeof row.runs === "number" ? row.runs : undefined,
      found: typeof row.found === "number" ? row.found : undefined,
      valid: typeof row.valid === "number" ? row.valid : undefined,
      relevant: typeof row.relevant === "number" ? row.relevant : undefined,
      avg_score: typeof row.avg_score === "number" ? row.avg_score : undefined,
    };
  }
  return Object.keys(out.preferred_by_platform).length ? out : null;
}

function sourceHistory(playbook: unknown): ReelsBrainSourceHistoryEntry[] {
  const pb = rec(playbook);
  const root = rec(pb.reels_brain_sources);
  const history = Array.isArray(root.history) ? root.history : [];
  const out: ReelsBrainSourceHistoryEntry[] = [];
  for (const entry of history) {
    const row = rec(entry);
    const provider = String(row.provider || "").trim().toLowerCase();
    if (!provider) continue;
    out.push({
      platform: normalizeShortPlatform(row.platform),
      provider: provider as ReelsBrainProvider,
      updated_at: String(row.updated_at || ""),
      source: String(row.source || "unknown"),
      runs: typeof row.runs === "number" ? row.runs : undefined,
      found: typeof row.found === "number" ? row.found : undefined,
      valid: typeof row.valid === "number" ? row.valid : undefined,
      relevant: typeof row.relevant === "number" ? row.relevant : undefined,
      avg_score: typeof row.avg_score === "number" ? row.avg_score : undefined,
    });
  }
  return out;
}

function policyRoot(playbook: unknown): Record<string, unknown> {
  const pb = rec(playbook);
  return rec(pb.reels_brain_policy);
}

function queryRoot(playbook: unknown): Record<string, unknown> {
  const pb = rec(playbook);
  return rec(pb.reels_brain_queries);
}

function incidentRoot(playbook: unknown): Record<string, unknown> {
  const pb = rec(playbook);
  return rec(pb.reels_brain_incidents);
}

function automationRoot(playbook: unknown): Record<string, unknown> {
  const pb = rec(playbook);
  return rec(pb.reels_brain_automation);
}

function daysSinceIso(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
}

export function normalizeTargetPlatform(value: unknown): ReelsPlatform {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "tiktok";
  if (raw.includes("instagram") || raw === "ig" || raw === "reels") return "instagram";
  if (raw.includes("youtube") || raw.includes("shorts") || raw === "yt") return "youtube";
  if (raw.includes("tiktok") || raw === "tt") return "tiktok";
  return "tiktok";
}

export function sourceRelearnPolicy(playbook: unknown, targetPlatform: unknown): ReelsBrainRelearnPolicy {
  const platform = normalizeShortPlatform(targetPlatform);
  const root = policyRoot(playbook);
  const relearn = rec(root.relearn);
  const row = rec(relearn[platform]);
  const defaults = DEFAULT_RELEARN_POLICIES[platform];
  return {
    min_found: Math.max(1, num(row.min_found, defaults.min_found)),
    min_relevant: Math.max(1, num(row.min_relevant, defaults.min_relevant)),
    min_inserted: Math.max(0, num(row.min_inserted, defaults.min_inserted)),
    stale_days: Math.max(1, num(row.stale_days, defaults.stale_days)),
    bake_off_limit: Math.max(5, num(row.bake_off_limit, defaults.bake_off_limit)),
    retry_limit: Math.max(0, num(row.retry_limit, defaults.retry_limit)),
  };
}

export function corpusQualityGate(playbook: unknown, targetPlatform: unknown): ReelsBrainCorpusQualityGate {
  const platform = normalizeShortPlatform(targetPlatform);
  const root = policyRoot(playbook);
  const quality = rec(root.quality_gates);
  const row = rec(quality[platform]);
  const defaults = DEFAULT_QUALITY_GATES[platform];
  return {
    min_videos: Math.max(1, num(row.min_videos, defaults.min_videos)),
    min_analyzed: Math.max(1, num(row.min_analyzed, defaults.min_analyzed)),
    min_patterns: Math.max(1, num(row.min_patterns, defaults.min_patterns)),
    min_winners: Math.max(0, num(row.min_winners, defaults.min_winners)),
  };
}

export function preferredSourceProvider(playbook: unknown, targetPlatform: unknown): ReelsBrainProvider | null {
  const memory = sourceMemory(playbook);
  if (!memory) return null;
  const platform = normalizeTargetPlatform(targetPlatform);
  if (platform === "unknown") return null;
  return memory.preferred_by_platform[platform]?.provider || null;
}

export function preferredSourceProviders(playbook: unknown): ReelsBrainSourceMemory["preferred_by_platform"] {
  return sourceMemory(playbook)?.preferred_by_platform || {};
}

export function sourceProviderHistory(playbook: unknown, targetPlatform?: unknown): ReelsBrainSourceHistoryEntry[] {
  const history = sourceHistory(playbook)
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  if (targetPlatform == null) return history;
  const platform = normalizeShortPlatform(targetPlatform);
  return history.filter((row) => row.platform === platform);
}

export function recommendSourceQueries(playbook: unknown, niche: string, targetPlatform: unknown, seedQuery?: string | null): string[] {
  const platform = normalizeShortPlatform(targetPlatform);
  const pb = rec(playbook);
  const hooks = textList(pb.hooks);
  const winnerHooks = dedupeLoose([
    ...textList(pb.winner_hooks),
    ...textList(pb.top_hooks),
    ...textList(pb.reels_brain_top_hooks),
  ]);
  const winningFormats = Array.isArray(pb.winning_formats) ? pb.winning_formats : [];
  const formatNames = dedupeLoose([
    ...winningFormats
      .map((row) => rec(row))
      .map((row) => String(row.name || row.hook || row.title || "").trim())
      .filter(Boolean),
    ...textList(pb.top_formats),
    ...textList(pb.winner_formats),
  ]);
  const base = String(niche || "default").trim() || "default";
  const nicheKey = base.toLowerCase();
  const instagramNicheQueries = (() => {
    if (/^ru[_-]/.test(nicheKey) || /игруш|одеж|космет|макияж|уход|дет/.test(nicheKey)) {
      if (/toy|игруш|дет|kids/.test(nicheKey)) {
        return ["обзор игрушек", "распаковка игрушек", "детские игрушки", "развивающие игрушки", "популярные игрушки", "игрушки для детей", "сенсорные игрушки", "антистресс игрушки", "находки для детей"];
      }
      if (/cloth|одеж|fashion|outfit|style/.test(nicheKey)) {
        return ["обзор одежды", "примерка одежды", "образы на каждый день", "капсула гардероба", "находки одежды", "стильные образы", "что надеть", "лукбук", "одежда маркетплейс"];
      }
      if (/cosmetic|космет|makeup|beauty|skin|макияж|уход/.test(nicheKey)) {
        return ["обзор косметики", "макияж на каждый день", "уход за кожей", "тест косметики", "бьюти находки", "до после макияж", "утренний уход", "косметика маркетплейс", "честный обзор косметики"];
      }
      return ["русские рилс", "обзор товара", "находки маркетплейс", "честный обзор", "до после"];
    }
    if (/cloth|fashion|одеж|look|outfit|style/.test(nicheKey)) {
      return ["fashion haul", "outfit ideas", "clothing haul", "style inspiration", "try on haul", "summer outfits", "capsule wardrobe", "street style", "get dressed with me"];
    }
    if (/cosmetic|makeup|beauty|skin|космет|макияж|уход/.test(nicheKey)) {
      return ["makeup tutorial", "skincare routine", "beauty hacks", "before after makeup", "get ready with me", "makeup routine", "beauty products", "skin care tips", "clean girl makeup"];
    }
    if (/toy|kids|дет|игруш|game|play/.test(nicheKey)) {
      return ["toy review", "toy unboxing", "kids toys", "viral toys", "toy test", "sensory toys", "educational toys", "fidget toys", "toy haul"];
    }
    if (nicheKey === "default") {
      return ["makeup tutorial", "fashion haul", "skincare routine", "toy unboxing", "get ready with me", "outfit ideas", "beauty hacks"];
    }
    return [`${base} reels`, `${base} before after`, `${base} aesthetic`, `${base} routine`];
  })();
  const platformQueries: Record<"tiktok" | "instagram" | "youtube", string[]> = {
    tiktok: /^ru[_-]/.test(nicheKey) || /игруш|одеж|космет|макияж|уход|дет/.test(nicheKey)
      ? instagramNicheQueries
      : [`${base} review`, `${base} test`, `${base} viral`, `${base} demo`],
    instagram: instagramNicheQueries,
    youtube: /^ru[_-]/.test(nicheKey) || /игруш|одеж|космет|макияж|уход|дет/.test(nicheKey)
      ? instagramNicheQueries.map((query) => `${query} shorts`)
      : [`${base} shorts`, `${base} review shorts`, `${base} test shorts`, `${base} demo shorts`],
  };
  const defaultQueries = platformQueries[platform];
  return dedupeLoose([
    seedQuery ? String(seedQuery).trim() : "",
    ...defaultQueries.slice(0, 2),
    ...winnerHooks.slice(0, 2).map((hook) => `${base} ${hook}`.slice(0, 120)),
    ...formatNames.slice(0, 2).map((format) => `${base} ${format}`.slice(0, 120)),
    ...hooks.slice(0, 1).map((hook) => `${base} ${hook}`.slice(0, 120)),
    ...defaultQueries.slice(2),
    ...winnerHooks.slice(2, 3).map((hook) => `${base} ${hook}`.slice(0, 120)),
    ...formatNames.slice(2, 3).map((format) => `${base} ${format}`.slice(0, 120)),
    ...hooks.slice(1, 2).map((hook) => `${base} ${hook}`.slice(0, 120)),
  ].map((row) => row.trim()).filter(Boolean)).slice(0, 8);
}

export function assessTrainingReadiness(
  playbook: unknown,
  targetPlatform: unknown,
  stats: { videos?: number; analyzed?: number; patterns?: number; winners?: number },
): ReelsBrainTrainingReadiness {
  const platform = normalizeShortPlatform(targetPlatform);
  const gates = corpusQualityGate(playbook, platform);
  const videos = Math.max(0, num(stats.videos, 0));
  const analyzed = Math.max(0, num(stats.analyzed, 0));
  const patterns = Math.max(0, num(stats.patterns, 0));
  const winners = Math.max(0, num(stats.winners, 0));
  const checks = [
    videos >= gates.min_videos,
    analyzed >= gates.min_analyzed,
    patterns >= gates.min_patterns,
    winners >= gates.min_winners,
  ];
  const missing: string[] = [];
  if (!checks[0]) missing.push(`videos < ${gates.min_videos}`);
  if (!checks[1]) missing.push(`analyzed < ${gates.min_analyzed}`);
  if (!checks[2]) missing.push(`patterns < ${gates.min_patterns}`);
  if (!checks[3]) missing.push(`winners < ${gates.min_winners}`);
  return {
    platform,
    ready: checks.every(Boolean),
    score: Math.round((checks.filter(Boolean).length / checks.length) * 100),
    videos,
    analyzed,
    patterns,
    winners,
    gates,
    missing,
  };
}

export function queryLeaderboard(playbook: unknown, targetPlatform?: unknown): ReelsBrainQueryStat[] {
  const root = queryRoot(playbook);
  const stats = Array.isArray(root.stats) ? root.stats : [];
  const platform = targetPlatform == null ? null : normalizeShortPlatform(targetPlatform);
  const out: ReelsBrainQueryStat[] = [];
  for (const item of stats) {
    const row = rec(item);
    const query = String(row.query || "").trim();
    if (!query) continue;
    const stat: ReelsBrainQueryStat = {
      query,
      platform: normalizeShortPlatform(row.platform),
      runs: Math.max(0, num(row.runs, 0)),
      found: Math.max(0, num(row.found, 0)),
      relevant: Math.max(0, num(row.relevant, 0)),
      inserted: Math.max(0, num(row.inserted, 0)),
      score: Math.max(0, num(row.score, 0)),
      updated_at: String(row.updated_at || ""),
      low_yield_runs: Math.max(0, num(row.low_yield_runs, 0)),
      empty_runs: Math.max(0, num(row.empty_runs, 0)),
      suppressed_until: row.suppressed_until ? String(row.suppressed_until) : undefined,
    };
    if (!platform || stat.platform === platform) out.push(stat);
  }
  return out.sort((a, b) =>
    b.score - a.score
    || b.inserted - a.inserted
    || b.relevant - a.relevant
    || a.query.localeCompare(b.query)
  );
}

export function rememberQueryPerformance(
  playbook: unknown,
  input: {
    query: string;
    platform: unknown;
    found?: number;
    relevant?: number;
    inserted?: number;
    updated_at?: string;
    low_yield?: boolean;
    empty_result?: boolean;
    provider_error?: boolean;
    suppression_hours?: number;
  },
): Record<string, unknown> {
  const pb = rec(playbook);
  const root = queryRoot(pb);
  const platform = normalizeShortPlatform(input.platform);
  const query = String(input.query || "").trim();
  if (!query) return { ...pb };
  const updatedAt = input.updated_at || new Date().toISOString();
  const stats = queryLeaderboard(pb);
  const rest = stats.filter((row) => !(row.platform === platform && row.query === query));
  const found = Math.max(0, num(input.found, 0));
  const relevant = Math.max(0, num(input.relevant, 0));
  const inserted = Math.max(0, num(input.inserted, 0));
  const providerError = Boolean(input.provider_error);
  const duplicatePenalty = found > 0 && inserted === 0 ? Math.min(30, found * 1.5) : 0;
  const score = Math.max(0, Math.round((relevant * 3 + inserted * 4 + found - duplicatePenalty) * 10) / 10);
  const current = stats.find((row) => row.platform === platform && row.query === query);
  const lowYield = Boolean(input.low_yield) || (found > 0 && inserted === 0);
  const emptyResult = !providerError && (Boolean(input.empty_result) || found === 0);
  const nextLowYieldRuns = lowYield ? (current?.low_yield_runs || 0) + 1 : 0;
  const nextEmptyRuns = providerError ? (current?.empty_runs || 0) : (emptyResult ? (current?.empty_runs || 0) + 1 : 0);
  const suppressionHours = Math.max(0, num(input.suppression_hours, emptyResult ? 48 : 24));
  const suppressedUntil = nextEmptyRuns >= 2 || nextLowYieldRuns >= 2
    ? new Date(new Date(updatedAt).getTime() + suppressionHours * 60 * 60 * 1000).toISOString()
    : undefined;
  const next: ReelsBrainQueryStat = {
    query,
    platform,
    runs: (current?.runs || 0) + 1,
    found: (current?.found || 0) + found,
    relevant: (current?.relevant || 0) + relevant,
    inserted: (current?.inserted || 0) + inserted,
    score: Math.round(((current?.score || 0) + score) * 10) / 10,
    updated_at: updatedAt,
    low_yield_runs: nextLowYieldRuns,
    empty_runs: nextEmptyRuns,
    suppressed_until: suppressedUntil,
  };
  return {
    ...pb,
    reels_brain_queries: {
      ...root,
      stats: [next, ...rest].slice(0, 60),
      rotation: {
        ...rec(root.rotation),
        [platform]: query,
      },
    },
  };
}

export function suppressedSourceQueries(playbook: unknown, targetPlatform?: unknown): ReelsBrainQueryStat[] {
  const now = Date.now();
  return queryLeaderboard(playbook, targetPlatform).filter((row) => {
    const until = row.suppressed_until ? new Date(row.suppressed_until).getTime() : NaN;
    return Number.isFinite(until) && until > now;
  });
}

export function recoverableSourceQueries(playbook: unknown, targetPlatform?: unknown): ReelsBrainQueryStat[] {
  const now = Date.now();
  return queryLeaderboard(playbook, targetPlatform)
    .filter((row) => {
      const until = row.suppressed_until ? new Date(row.suppressed_until).getTime() : NaN;
      return Number.isFinite(until) && until <= now;
    })
    .sort((a, b) =>
      String(a.suppressed_until || "").localeCompare(String(b.suppressed_until || ""))
      || String(b.updated_at).localeCompare(String(a.updated_at))
    );
}

export function nextRecommendedSourceQuery(playbook: unknown, niche: string, targetPlatform: unknown, fallback?: string | null): string | null {
  return nextRecommendedSourceQueries(playbook, niche, targetPlatform, fallback)[0] || fallback || null;
}

export function nextRecommendedSourceQueries(playbook: unknown, niche: string, targetPlatform: unknown, fallback?: string | null): string[] {
  const platform = normalizeShortPlatform(targetPlatform);
  const root = queryRoot(playbook);
  const rotation = rec(root.rotation);
  const lastUsed = String(rotation[platform] || "").trim();
  const suppressed = new Set(suppressedSourceQueries(playbook, platform).map((row) => row.query));
  const recoveryQueue = recoverableSourceQueries(playbook, platform).map((row) => row.query).filter((query) => !suppressed.has(query));
  const recoverySet = new Set(recoveryQueue);
  const leaderboard = queryLeaderboard(playbook, platform).map((row) => row.query).filter((query) => !suppressed.has(query) && !recoverySet.has(query));
  const defaults = recommendSourceQueries(playbook, niche, platform, fallback).filter((query) => !suppressed.has(query));
  const leadRecovery = recoveryQueue[0] ? [recoveryQueue[0]] : [];
  const tailRecovery = recoveryQueue.slice(1);
  const ordered = Array.from(new Set([...leadRecovery, ...leaderboard, ...defaults, ...tailRecovery].filter(Boolean)));
  const protectedRecovery = leadRecovery[0] || "";
  const filtered = ordered.filter((query) => query !== lastUsed || query === protectedRecovery);
  const safeLastUsed = lastUsed && !suppressed.has(lastUsed) ? [lastUsed] : [];
  return [...filtered, ...safeLastUsed].slice(0, 6);
}

export function incidentHistory(playbook: unknown, targetPlatform?: unknown): ReelsBrainIncident[] {
  const root = incidentRoot(playbook);
  const list = Array.isArray(root.history) ? root.history : [];
  const platform = targetPlatform == null ? null : normalizeShortPlatform(targetPlatform);
  const out: ReelsBrainIncident[] = [];
  for (const item of list) {
    const row = rec(item);
    const id = String(row.id || "").trim();
    if (!id) continue;
    const incident: ReelsBrainIncident = {
      id,
      platform: normalizeShortPlatform(row.platform),
      severity: (["info", "watch", "critical"].includes(String(row.severity)) ? String(row.severity) : "info") as ReelsBrainIncident["severity"],
      kind: ([
        "brain_not_ready",
        "provider_stale",
        "provider_drift",
        "low_yield",
        "empty_intake",
        "relearn_triggered",
      ].includes(String(row.kind)) ? String(row.kind) : "low_yield") as ReelsBrainIncident["kind"],
      message: String(row.message || ""),
      created_at: String(row.created_at || ""),
      niche: row.niche ? String(row.niche) : undefined,
      provider: row.provider ? String(row.provider) : undefined,
      query: row.query ? String(row.query) : undefined,
    };
    if (!platform || incident.platform === platform) out.push(incident);
  }
  return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function incidentSummary(playbook: unknown, targetPlatform?: unknown): ReelsBrainAlertSummary {
  const incidents = incidentHistory(playbook, targetPlatform);
  const byKind: Record<string, number> = {};
  let critical = 0;
  let watch = 0;
  let info = 0;
  for (const incident of incidents) {
    byKind[incident.kind] = (byKind[incident.kind] || 0) + 1;
    if (incident.severity === "critical") critical += 1;
    else if (incident.severity === "watch") watch += 1;
    else info += 1;
  }
  return { total: incidents.length, critical, watch, info, by_kind: byKind };
}

export function automationRunHistory(playbook: unknown): ReelsBrainAutomationRunHistoryEntry[] {
  const root = automationRoot(playbook);
  const list = Array.isArray(root.runs) ? root.runs : [];
  const out: ReelsBrainAutomationRunHistoryEntry[] = [];
  for (const item of list) {
    const row = rec(item);
    const id = String(row.id || "").trim();
    if (!id) continue;
    const platforms = Array.isArray(row.platforms)
      ? row.platforms.map(normalizeShortPlatform)
      : [];
    out.push({
      id,
      mode: (["daily", "weekly", "growth", "bulk", "learning", "analyze"].includes(String(row.mode)) ? String(row.mode) : "learning") as ReelsBrainAutomationRunHistoryEntry["mode"],
      strategy: row.strategy ? String(row.strategy) : undefined,
      created_at: String(row.created_at || ""),
      niche: row.niche ? String(row.niche) : undefined,
      platforms: Array.from(new Set(platforms)),
      ok: row.ok !== false,
      found: Math.max(0, num(row.found, 0)),
      inserted: Math.max(0, num(row.inserted, 0)),
      analyzed: Math.max(0, num(row.analyzed, 0)),
      relevant: Math.max(0, num(row.relevant, 0)),
      retries: Math.max(0, num(row.retries, 0)),
      errors: Math.max(0, num(row.errors, 0)),
      best_provider: row.best_provider ? String(row.best_provider) : null,
      cost_units: Math.max(0, num(row.cost_units, 0)) || undefined,
      pattern_gain_proxy: Math.max(0, num(row.pattern_gain_proxy, 0)) || undefined,
      high_trust_gain_proxy: Math.max(0, num(row.high_trust_gain_proxy, 0)) || undefined,
      estimated_spend_usd: Math.max(0, num(row.estimated_spend_usd, 0)) || undefined,
      actual_spend_usd: row.actual_spend_usd == null ? null : Math.max(0, num(row.actual_spend_usd, 0)),
      spend_source: row.spend_source === "actual" ? "actual" : row.spend_source === "estimated" ? "estimated" : undefined,
    });
  }
  return out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function rememberAutomationRun(
  playbook: unknown,
  input: Omit<ReelsBrainAutomationRunHistoryEntry, "id" | "created_at"> & { id?: string; created_at?: string },
): Record<string, unknown> {
  const pb = rec(playbook);
  const root = automationRoot(pb);
  const createdAt = input.created_at || new Date().toISOString();
  const platforms = Array.from(new Set((input.platforms || []).map(normalizeShortPlatform)));
  const entry: ReelsBrainAutomationRunHistoryEntry = {
    id: input.id || `${input.mode}:${input.niche || "all"}:${createdAt}`,
    mode: input.mode,
    strategy: input.strategy,
    created_at: createdAt,
    niche: input.niche,
    platforms,
    ok: input.ok,
    found: Math.max(0, num(input.found, 0)),
    inserted: Math.max(0, num(input.inserted, 0)),
    analyzed: Math.max(0, num(input.analyzed, 0)),
    relevant: Math.max(0, num(input.relevant, 0)),
    retries: Math.max(0, num(input.retries, 0)),
    errors: Math.max(0, num(input.errors, 0)),
    best_provider: input.best_provider || null,
    cost_units: Math.max(0, num(input.cost_units, 0)) || undefined,
    pattern_gain_proxy: Math.max(0, num(input.pattern_gain_proxy, 0)) || undefined,
    high_trust_gain_proxy: Math.max(0, num(input.high_trust_gain_proxy, 0)) || undefined,
    estimated_spend_usd: Math.max(0, num(input.estimated_spend_usd, 0)) || undefined,
    actual_spend_usd: input.actual_spend_usd == null ? null : Math.max(0, num(input.actual_spend_usd, 0)),
    spend_source: input.spend_source === "actual" ? "actual" : input.spend_source === "estimated" ? "estimated" : undefined,
  };
  const history = automationRunHistory(pb).filter((row) => row.id !== entry.id);
  return {
    ...pb,
    reels_brain_automation: {
      ...root,
      runs: [entry, ...history].slice(0, 50),
      latest: entry,
    },
  };
}

export function rememberIncident(
  playbook: unknown,
  incident: Omit<ReelsBrainIncident, "id" | "created_at" | "platform"> & { platform: unknown; id?: string; created_at?: string; cooldown_hours?: number },
): Record<string, unknown> {
  const pb = rec(playbook);
  const root = incidentRoot(pb);
  const platform = normalizeShortPlatform(incident.platform);
  const createdAt = incident.created_at || new Date().toISOString();
  const cooldownHours = Math.max(0, num(incident.cooldown_hours, 12));
  const existing = incidentHistory(pb, platform).find((row) =>
    row.kind === incident.kind
    && row.message === incident.message
    && row.provider === incident.provider
    && row.query === incident.query
  );
  if (existing && cooldownHours > 0) {
    const ageHours = (Date.now() - new Date(existing.created_at).getTime()) / (60 * 60 * 1000);
    if (Number.isFinite(ageHours) && ageHours < cooldownHours) return { ...pb };
  }
  const next: ReelsBrainIncident = {
    id: incident.id || `${platform}:${incident.kind}:${createdAt}`,
    platform,
    severity: incident.severity,
    kind: incident.kind,
    message: incident.message,
    created_at: createdAt,
    niche: incident.niche,
    provider: incident.provider,
    query: incident.query,
  };
  const history = incidentHistory(pb).filter((row) => row.id !== next.id);
  return {
    ...pb,
    reels_brain_incidents: {
      ...root,
      history: [next, ...history].slice(0, 50),
    },
  };
}

export function rememberSourceProvider(
  playbook: unknown,
  targetPlatform: unknown,
  choice: Omit<ReelsBrainSourceChoice, "updated_at"> & { updated_at?: string },
): Record<string, unknown> {
  const pb = rec(playbook);
  const root = rec(pb.reels_brain_sources);
  const current = rec(root.preferred_by_platform);
  const platform = normalizeTargetPlatform(targetPlatform);
  if (platform === "unknown") return { ...pb };
  const updatedAt = choice.updated_at || new Date().toISOString();
  const nextEntry: ReelsBrainSourceHistoryEntry = {
    platform: normalizeShortPlatform(platform),
    provider: String(choice.provider || "").trim().toLowerCase() as ReelsBrainProvider,
    updated_at: updatedAt,
    source: String(choice.source || "unknown"),
    runs: choice.runs,
    found: choice.found,
    valid: choice.valid,
    relevant: choice.relevant,
    avg_score: choice.avg_score,
  };
  return {
    ...pb,
    reels_brain_sources: {
      ...root,
      preferred_by_platform: {
        ...current,
        [platform]: {
          ...rec(current[platform]),
          ...choice,
          provider: String(choice.provider || "").trim().toLowerCase(),
          updated_at: updatedAt,
        },
      },
      history: [nextEntry, ...sourceHistory(pb)].slice(0, 24),
    },
  };
}

export function selectReelsBrain(playbook: unknown, targetPlatform: unknown): SelectedReelsBrain {
  const requested = normalizeTargetPlatform(targetPlatform);
  const pb = rec(playbook);
  const root = rec(pb.reels_brain_patterns);
  const bundle = root as unknown as Partial<ReelsPatternMemoryBundle>;
  const metaBrain = asMemory(bundle.meta_brain) || asMemory(root) || null;
  const platformBrains = rec(bundle.platform_brains);
  const exactBrain = asMemory(platformBrains[requested]);
  const fallbackBrain = exactBrain || metaBrain;
  const crossPlatformPatterns = Array.isArray(bundle.cross_platform_patterns)
    ? (bundle.cross_platform_patterns as CrossPlatformPattern[])
    : [];
  const rebuildContext = bundle.rebuild_context && typeof bundle.rebuild_context === "object"
    ? bundle.rebuild_context as ReelsPatternRebuildContext
    : null;

  return {
    platform: exactBrain?.platform === requested ? requested : requested,
    requested_platform: requested,
    brain: fallbackBrain,
    meta_brain: metaBrain,
    cross_platform_patterns: crossPlatformPatterns,
    rebuild_context: rebuildContext,
  };
}

export function buildPlatformBrainHint(playbook: unknown, targetPlatform: unknown): string {
  const selected = selectReelsBrain(playbook, targetPlatform);
  const brain = selected.brain;
  if (!brain) return "";

  const topPatterns = brain.patterns.slice(0, 3);
  const topHooks = brain.top_hooks.slice(0, 5);
  const cross = selected.cross_platform_patterns
    .filter((pattern) => pattern.platforms.includes(selected.requested_platform))
    .slice(0, 3);

  const parts = [
    `\nPLATFORM BRAIN (${selected.requested_platform.toUpperCase()}): используй паттерны только этой платформы, не мешай их с общим short-form стилем.`,
  ];
  if (topHooks.length) parts.push(`\nТоп хуки платформы: ${topHooks.join(" | ")}`);
  if (topPatterns.length) {
    parts.push(`\nТоп паттерны платформы: ${topPatterns.map((pattern) =>
      `${pattern.hook_label || labelReelsHookType(pattern.hook_type)} / ${pattern.structure_label || labelReelsStructureType(pattern.structure_type)} / ${pattern.retention_label || labelReelsRetentionMechanism(pattern.retention_mechanism)} / частота ${pattern.frequency}`
    ).join(" | ")}`);
  }
  if (cross.length) {
    parts.push(`\nПереносимые cross-platform идеи для этой платформы: ${cross.map((pattern) =>
      `${pattern.hook_label || labelReelsHookType(pattern.hook_type)} / ${pattern.structure_label || labelReelsStructureType(pattern.structure_type)} (${pattern.platforms.join("+")})`
    ).join(" | ")}`);
  }
  return parts.join("");
}
