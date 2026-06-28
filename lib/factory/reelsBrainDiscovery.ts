import { normalizeReelsVideo, scoreReelsVideo, type ReelsBrainInput, type ReelsPlatform } from "./reelsBrain";
import { isRelevantToQuery, type ReelsBrainProvider } from "./reelsBrainSources";
import { nextRecommendedSourceQueries, normalizeShortPlatform, queryLeaderboard } from "./reelsBrainPlaybook";

export type ReelsDiscoverySourceType = "query" | "hashtag" | "account" | "sound" | "manual_url";
export type ReelsDiscoverySourceStatus = "active" | "paused" | "banned";
export type ReelsDiscoveryLane = "explore" | "exploit" | "refresh";

export interface ReelsDiscoverySource {
  id: string;
  type: ReelsDiscoverySourceType;
  platform: Exclude<ReelsPlatform, "unknown">;
  niche: string;
  value: string;
  status: ReelsDiscoverySourceStatus;
  yield_score: number;
  relevance_rate: number;
  breakout_rate: number;
  cost_per_relevant: number;
  runs: number;
  found: number;
  relevant: number;
  breakout: number;
  inserted: number;
  last_checked_at?: string;
  next_check_at?: string;
  reason?: string;
}

export interface ReelsDiscoveryCandidateScore {
  relevant: boolean;
  relevance_score: number;
  breakout_score: number;
  small_account_score: number;
  candidate_score: number;
  breakout_ratio: number | null;
  reasons: string[];
}

export interface ReelsDiscoveryPlanItem {
  lane: ReelsDiscoveryLane;
  source: ReelsDiscoverySource;
  provider_hint?: ReelsBrainProvider | null;
  source_run_payload: {
    niche: string;
    target_platform: Exclude<ReelsPlatform, "unknown">;
    query: string;
    limit: number;
    provider_hint?: ReelsBrainProvider | null;
    discovery_source_id: string;
    discovery_source_type: ReelsDiscoverySourceType;
  };
}

export interface ReelsDiscoveryPlan {
  niche: string;
  platform: Exclude<ReelsPlatform, "unknown">;
  budget_split: Record<ReelsDiscoveryLane, number>;
  items: ReelsDiscoveryPlanItem[];
  source_count: number;
  active_source_count: number;
  notes: string[];
}

export interface ReelsDiscoveryReplayRow {
  url?: string | null;
  platform?: string | null;
  niche?: string | null;
  caption?: string | null;
  views?: number | string | null;
  likes?: number | string | null;
  followers_creator?: number | string | null;
  virality_score?: number | string | null;
  sound_id?: string | null;
  sound_title?: string | null;
  source_orbit_id?: string | null;
}

export interface ReelsDiscoveryReplaySource {
  type: ReelsDiscoverySourceType;
  value: string;
  provider?: string | null;
  found: number;
  relevant: number;
  breakout: number;
  inserted: number;
  avg_candidate_score: number;
  avg_relevance_score: number;
  avg_breakout_score: number;
  yield_score: number;
  relevance_rate: number;
  breakout_rate: number;
  sample_urls: string[];
}

export interface ReelsDiscoveryReplay {
  niche: string;
  platform: Exclude<ReelsPlatform, "unknown">;
  scanned: number;
  relevant: number;
  breakout: number;
  sources: ReelsDiscoveryReplaySource[];
  sound_sources: ReelsDiscoveryReplaySource[];
  notes: string[];
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clean(value: unknown, max = 160): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sourceId(input: { type: ReelsDiscoverySourceType; platform: string; niche: string; value: string }): string {
  return [
    input.platform,
    input.niche,
    input.type,
    input.value.toLowerCase().replace(/^#/, "").replace(/[^a-zа-яё0-9._/@-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "source",
  ].join(":");
}

function splitSourceOrbit(value: string | null | undefined): { provider: string | null; query: string | null } {
  const source = clean(value, 240);
  if (!source) return { provider: null, query: null };
  const idx = source.indexOf(":");
  if (idx < 0) return { provider: null, query: source };
  return {
    provider: clean(source.slice(0, idx), 80) || null,
    query: clean(source.slice(idx + 1), 160) || null,
  };
}

function discoveryRoot(playbook: unknown): Record<string, unknown> {
  return rec(rec(playbook).reels_brain_discovery);
}

export function discoverySources(playbook: unknown, filters?: {
  niche?: string;
  platform?: unknown;
  includePaused?: boolean;
}): ReelsDiscoverySource[] {
  const root = discoveryRoot(playbook);
  const raw = Array.isArray(root.sources) ? root.sources : [];
  const platform = filters?.platform == null ? null : normalizeShortPlatform(filters.platform);
  const niche = clean(filters?.niche || "", 80);
  const out: ReelsDiscoverySource[] = [];

  for (const item of raw) {
    const row = rec(item);
    const type = clean(row.type) as ReelsDiscoverySourceType;
    if (!["query", "hashtag", "account", "sound", "manual_url"].includes(type)) continue;
    const sourcePlatform = normalizeShortPlatform(row.platform);
    const sourceNiche = clean(row.niche || "default", 80) || "default";
    const value = clean(row.value, 180);
    if (!value) continue;
    const status = (["active", "paused", "banned"].includes(clean(row.status)) ? clean(row.status) : "active") as ReelsDiscoverySourceStatus;
    if (!filters?.includePaused && status !== "active") continue;
    if (platform && sourcePlatform !== platform) continue;
    if (niche && sourceNiche !== niche) continue;
    out.push({
      id: clean(row.id) || sourceId({ type, platform: sourcePlatform, niche: sourceNiche, value }),
      type,
      platform: sourcePlatform,
      niche: sourceNiche,
      value,
      status,
      yield_score: clamp(num(row.yield_score), 0, 100),
      relevance_rate: clamp(num(row.relevance_rate), 0, 1),
      breakout_rate: clamp(num(row.breakout_rate), 0, 1),
      cost_per_relevant: Math.max(0, num(row.cost_per_relevant)),
      runs: Math.max(0, num(row.runs)),
      found: Math.max(0, num(row.found)),
      relevant: Math.max(0, num(row.relevant)),
      breakout: Math.max(0, num(row.breakout)),
      inserted: Math.max(0, num(row.inserted)),
      last_checked_at: row.last_checked_at ? clean(row.last_checked_at, 60) : undefined,
      next_check_at: row.next_check_at ? clean(row.next_check_at, 60) : undefined,
      reason: row.reason ? clean(row.reason, 240) : undefined,
    });
  }

  return out.sort((a, b) =>
    b.yield_score - a.yield_score
    || b.breakout_rate - a.breakout_rate
    || b.relevance_rate - a.relevance_rate
    || a.value.localeCompare(b.value)
  );
}

export function scoreDiscoveryCandidate(query: string, input: ReelsBrainInput, opts?: {
  authorBaselineViews?: number | null;
  minRelevantScore?: number;
}): ReelsDiscoveryCandidateScore {
  const normalized = normalizeReelsVideo(input);
  if (!normalized) {
    return {
      relevant: false,
      relevance_score: 0,
      breakout_score: 0,
      small_account_score: 0,
      candidate_score: 0,
      breakout_ratio: null,
      reasons: ["invalid_video"],
    };
  }
  const viral = scoreReelsVideo(normalized).total;
  const queryRelevant = isRelevantToQuery(query, input);
  const captionHasRu = /[а-яё]/i.test([normalized.caption, normalized.author, normalized.soundTitle, normalized.hashtags.join(" ")].filter(Boolean).join(" "));
  const relevanceScore = clamp((queryRelevant ? 55 : 15) + (captionHasRu ? 25 : 0) + Math.min(20, viral / 2), 0, 100);
  const views = normalized.views || 0;
  const followers = normalized.followers || 0;
  const baseline = Math.max(0, Number(opts?.authorBaselineViews || 0));
  const breakoutRatio = baseline > 0
    ? views / Math.max(1, baseline)
    : followers > 0
      ? views / Math.max(500, followers)
      : null;
  const breakoutScore = breakoutRatio == null ? 0 : clamp(Math.log10(breakoutRatio + 1) * 42, 0, 100);
  const smallAccountScore = followers > 0 && followers <= 50_000 ? clamp(100 - (followers / 50_000) * 40, 0, 100) : 0;
  const candidateScore = Math.round((relevanceScore * 0.45 + breakoutScore * 0.35 + smallAccountScore * 0.2) * 10) / 10;
  const reasons: string[] = [];
  if (queryRelevant) reasons.push("query_match");
  if (captionHasRu) reasons.push("ru_signal");
  if (breakoutScore >= 45) reasons.push("breakout_candidate");
  if (smallAccountScore >= 50) reasons.push("small_account_signal");
  if (views <= 0) reasons.push("missing_views");
  if (followers <= 0 && baseline <= 0) reasons.push("missing_author_baseline");
  const minRelevantScore = clamp(Number(opts?.minRelevantScore || 55), 0, 100);

  return {
    relevant: relevanceScore >= minRelevantScore,
    relevance_score: Math.round(relevanceScore),
    breakout_score: Math.round(breakoutScore),
    small_account_score: Math.round(smallAccountScore),
    candidate_score: candidateScore,
    breakout_ratio: breakoutRatio == null ? null : Math.round(breakoutRatio * 10) / 10,
    reasons,
  };
}

function scoreSource(input: {
  found: number;
  relevant: number;
  breakout: number;
  inserted: number;
  costUnits: number;
}): { yield_score: number; relevance_rate: number; breakout_rate: number; cost_per_relevant: number } {
  const found = Math.max(0, input.found);
  const relevant = Math.max(0, input.relevant);
  const breakout = Math.max(0, input.breakout);
  const inserted = Math.max(0, input.inserted);
  const costUnits = Math.max(1, input.costUnits);
  const relevanceRate = found ? relevant / found : 0;
  const breakoutRate = relevant ? breakout / relevant : 0;
  const costPerRelevant = relevant ? costUnits / relevant : costUnits;
  const useful = relevanceRate * 45 + breakoutRate * 35 + Math.min(20, inserted * 2);
  const costPenalty = Math.min(35, costPerRelevant * 6);
  return {
    yield_score: Math.round(clamp(useful - costPenalty + 15, 0, 100) * 10) / 10,
    relevance_rate: Math.round(relevanceRate * 1000) / 1000,
    breakout_rate: Math.round(breakoutRate * 1000) / 1000,
    cost_per_relevant: Math.round(costPerRelevant * 100) / 100,
  };
}

export function rememberDiscoverySourceRun(playbook: unknown, input: {
  niche: string;
  platform: unknown;
  type: ReelsDiscoverySourceType;
  value: string;
  found?: number;
  relevant?: number;
  breakout?: number;
  inserted?: number;
  cost_units?: number;
  status?: ReelsDiscoverySourceStatus;
  reason?: string;
  checked_at?: string;
}): Record<string, unknown> {
  const pb = rec(playbook);
  const root = discoveryRoot(pb);
  const platform = normalizeShortPlatform(input.platform);
  const niche = clean(input.niche || "default", 80) || "default";
  const type = input.type;
  const value = clean(input.value, 180);
  if (!value) return { ...pb };
  const id = sourceId({ type, platform, niche, value });
  const existing = discoverySources(pb, { includePaused: true }).find((row) => row.id === id);
  const found = Math.max(0, num(input.found));
  const relevant = Math.max(0, num(input.relevant));
  const breakout = Math.max(0, num(input.breakout));
  const inserted = Math.max(0, num(input.inserted));
  const scored = scoreSource({
    found: (existing?.found || 0) + found,
    relevant: (existing?.relevant || 0) + relevant,
    breakout: (existing?.breakout || 0) + breakout,
    inserted: (existing?.inserted || 0) + inserted,
    costUnits: Math.max(1, num(input.cost_units, 1) + (existing?.runs || 0)),
  });
  const checkedAt = input.checked_at || new Date().toISOString();
  const status = input.status || (scored.yield_score < 10 && (existing?.runs || 0) >= 2 ? "paused" : "active");
  const next: ReelsDiscoverySource = {
    id,
    type,
    platform,
    niche,
    value,
    status,
    ...scored,
    runs: (existing?.runs || 0) + 1,
    found: (existing?.found || 0) + found,
    relevant: (existing?.relevant || 0) + relevant,
    breakout: (existing?.breakout || 0) + breakout,
    inserted: (existing?.inserted || 0) + inserted,
    last_checked_at: checkedAt,
    reason: clean(input.reason || existing?.reason || "", 240) || undefined,
  };
  const rest = discoverySources(pb, { includePaused: true }).filter((row) => row.id !== id);
  const history = Array.isArray(root.history) ? root.history : [];

  return {
    ...pb,
    reels_brain_discovery: {
      ...root,
      sources: [next, ...rest].slice(0, 200),
      history: [{
        id: `${id}:${checkedAt}`,
        source_id: id,
        niche,
        platform,
        type,
        value,
        found,
        relevant,
        breakout,
        inserted,
        cost_units: Math.max(1, num(input.cost_units, 1)),
        yield_score: next.yield_score,
        created_at: checkedAt,
      }, ...history].slice(0, 200),
    },
  };
}

function replayGroupSummary(group: {
  type: ReelsDiscoverySourceType;
  value: string;
  provider?: string | null;
  rows: { row: ReelsDiscoveryReplayRow; score: ReelsDiscoveryCandidateScore }[];
}): ReelsDiscoveryReplaySource {
  const found = group.rows.length;
  const relevant = group.rows.filter((item) => item.score.relevant).length;
  const breakout = group.rows.filter((item) => item.score.breakout_score >= 45).length;
  const inserted = relevant;
  const scored = scoreSource({ found, relevant, breakout, inserted, costUnits: 1 });
  const avg = (selector: (score: ReelsDiscoveryCandidateScore) => number) => found
    ? Math.round(group.rows.reduce((sum, item) => sum + selector(item.score), 0) / found * 10) / 10
    : 0;
  return {
    type: group.type,
    value: group.value,
    provider: group.provider || null,
    found,
    relevant,
    breakout,
    inserted,
    avg_candidate_score: avg((score) => score.candidate_score),
    avg_relevance_score: avg((score) => score.relevance_score),
    avg_breakout_score: avg((score) => score.breakout_score),
    ...scored,
    sample_urls: group.rows
      .sort((a, b) => b.score.candidate_score - a.score.candidate_score)
      .map((item) => clean(item.row.url, 500))
      .filter(Boolean)
      .slice(0, 5),
  };
}

export function buildDiscoveryReplay(input: {
  niche: string;
  platform: unknown;
  rows: ReelsDiscoveryReplayRow[];
  min_candidate_score?: number;
}): ReelsDiscoveryReplay {
  const niche = clean(input.niche || "default", 80) || "default";
  const platform = normalizeShortPlatform(input.platform);
  const minCandidateScore = clamp(num(input.min_candidate_score, 45), 0, 100);
  const queryGroups = new Map<string, {
    type: ReelsDiscoverySourceType;
    value: string;
    provider?: string | null;
    rows: { row: ReelsDiscoveryReplayRow; score: ReelsDiscoveryCandidateScore }[];
  }>();
  const soundGroups = new Map<string, {
    type: ReelsDiscoverySourceType;
    value: string;
    provider?: string | null;
    rows: { row: ReelsDiscoveryReplayRow; score: ReelsDiscoveryCandidateScore }[];
  }>();
  let relevant = 0;
  let breakout = 0;

  for (const row of input.rows) {
    const source = splitSourceOrbit(row.source_orbit_id);
    const query = source.query || niche;
    const score = scoreDiscoveryCandidate(query, {
      url: row.url || undefined,
      platform: row.platform || platform,
      caption: row.caption || undefined,
      views: row.views,
      likes: row.likes,
      followers: row.followers_creator,
      sound_id: row.sound_id || undefined,
      sound_title: row.sound_title || undefined,
    });
    const effectiveRelevant = score.relevant && score.candidate_score >= minCandidateScore;
    if (effectiveRelevant) relevant += 1;
    if (score.breakout_score >= 45) breakout += 1;
    const queryKey = `${source.provider || "unknown"}:${query}`;
    const queryGroup = queryGroups.get(queryKey) || { type: "query" as const, value: query, provider: source.provider, rows: [] };
    queryGroup.rows.push({ row, score: { ...score, relevant: effectiveRelevant } });
    queryGroups.set(queryKey, queryGroup);

    const sound = clean(row.sound_title || row.sound_id || "", 160);
    if (sound) {
      const soundGroup = soundGroups.get(sound) || { type: "sound" as const, value: sound, provider: source.provider, rows: [] };
      soundGroup.rows.push({ row, score: { ...score, relevant: effectiveRelevant } });
      soundGroups.set(sound, soundGroup);
    }
  }

  const sourceSummaries = Array.from(queryGroups.values())
    .map(replayGroupSummary)
    .sort((a, b) => b.yield_score - a.yield_score || b.relevant - a.relevant || b.found - a.found);
  const soundSummaries = Array.from(soundGroups.values())
    .filter((group) => group.rows.length >= 2)
    .map(replayGroupSummary)
    .sort((a, b) => b.yield_score - a.yield_score || b.breakout - a.breakout || b.found - a.found);

  return {
    niche,
    platform,
    scanned: input.rows.length,
    relevant,
    breakout,
    sources: sourceSummaries,
    sound_sources: soundSummaries.slice(0, 30),
    notes: [
      "Replay uses already stored viral_videos rows; it does not call Apify/providers.",
      "Account extraction is not available for older corpus rows because author/username is not stored in viral_videos.",
    ],
  };
}

function seedSources(playbook: unknown, niche: string, platform: Exclude<ReelsPlatform, "unknown">, limit: number): ReelsDiscoverySource[] {
  const queryStats = queryLeaderboard(playbook, platform).slice(0, limit);
  const queries = [
    ...queryStats.map((row) => row.query),
    ...nextRecommendedSourceQueries(playbook, niche, platform, niche),
  ];
  const seen = new Set<string>();
  const out: ReelsDiscoverySource[] = [];
  for (const query of queries) {
    const value = clean(query, 140);
    if (!value) continue;
    const id = sourceId({ type: "query", platform, niche, value });
    if (seen.has(id)) continue;
    seen.add(id);
    const stat = queryStats.find((row) => row.query === value);
    const found = stat?.found || 0;
    const relevant = stat?.relevant || 0;
    const inserted = stat?.inserted || 0;
    const scored = scoreSource({ found, relevant, breakout: 0, inserted, costUnits: Math.max(1, stat?.runs || 1) });
    out.push({
      id,
      type: "query",
      platform,
      niche,
      value,
      status: "active",
      ...scored,
      runs: stat?.runs || 0,
      found,
      relevant,
      breakout: 0,
      inserted,
      reason: stat ? "learned query source" : "recommended query seed",
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function buildDiscoveryPlan(playbook: unknown, input: {
  niche: string;
  platform: unknown;
  max_items?: number;
  source_limit?: number;
  provider_hint?: ReelsBrainProvider | null;
}): ReelsDiscoveryPlan {
  const niche = clean(input.niche || "default", 80) || "default";
  const platform = normalizeShortPlatform(input.platform);
  const maxItems = clamp(num(input.max_items, 6), 1, 20);
  const sourceLimit = clamp(num(input.source_limit, 25), 1, 100);
  const learnedSources = discoverySources(playbook, { niche, platform });
  const seeds = seedSources(playbook, niche, platform, Math.max(4, maxItems));
  const byId = new Map<string, ReelsDiscoverySource>();
  for (const source of [...learnedSources, ...seeds]) if (!byId.has(source.id)) byId.set(source.id, source);
  const sources = Array.from(byId.values());
  const activeSources = sources.filter((source) => source.status === "active");
  const exploit = activeSources.filter((source) => source.yield_score >= 45).slice(0, Math.ceil(maxItems * 0.7));
  const refresh = activeSources
    .filter((source) => source.runs > 0 && source.yield_score >= 20 && !exploit.some((row) => row.id === source.id))
    .slice(0, Math.max(1, Math.floor(maxItems * 0.1)));
  const used = new Set([...exploit, ...refresh].map((source) => source.id));
  const explore = activeSources
    .filter((source) => !used.has(source.id))
    .sort((a, b) => a.runs - b.runs || b.yield_score - a.yield_score)
    .slice(0, Math.max(1, maxItems - exploit.length - refresh.length));
  const items: ReelsDiscoveryPlanItem[] = [
    ...exploit.map((source) => ({ lane: "exploit" as const, source })),
    ...explore.map((source) => ({ lane: "explore" as const, source })),
    ...refresh.map((source) => ({ lane: "refresh" as const, source })),
  ].slice(0, maxItems).map(({ lane, source }) => ({
    lane,
    source,
    provider_hint: input.provider_hint || null,
    source_run_payload: {
      niche,
      target_platform: platform,
      query: source.value,
      limit: sourceLimit,
      provider_hint: input.provider_hint || undefined,
      discovery_source_id: source.id,
      discovery_source_type: source.type,
    },
  }));

  return {
    niche,
    platform,
    budget_split: { explore: 20, exploit: 70, refresh: 10 },
    items,
    source_count: sources.length,
    active_source_count: activeSources.length,
    notes: [
      "Discovery Intelligence plans cheap source collection before expensive analysis.",
      "Use source_run_payload with /api/factory/reels-brain/source-run; then POST results to discovery/learn.",
    ],
  };
}
