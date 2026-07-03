import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { makeViralVideoRows } from "@/lib/factory/reelsBrain";
import {
  availableReelsBrainProviders,
  fetchReelsBrainProvider,
  hasReelsBrainProvider,
  type ReelsBrainProvider,
} from "@/lib/factory/reelsBrainSources";
import {
  buildCorpusGrowthQueue,
  parseAutomationNiches,
  parseAutomationPlatforms,
  type ReelsBrainCorpusGrowthLane,
} from "@/lib/factory/reelsBrainAutomation";
import { nextRecommendedSourceQueries, queryLeaderboard, rememberQueryPerformance } from "@/lib/factory/reelsBrainPlaybook";
import { corpusProgress, corpusTargetByPlatform } from "@/lib/factory/reelsBrainCorpusTargets";
import { reelsBrainEnvStatus } from "@/lib/factory/reelsBrainEnv";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { buildReelsBrainBudgetPlan, reelsBrainBudgetLimits } from "@/lib/factory/reelsBrainBudget";
import { persistReelsBrainAutomationRun, summarizeReelsBrainAutomationRuns } from "@/lib/factory/reelsBrainAutomationRuns";
import { rememberDiscoverySourceRun } from "@/lib/factory/reelsBrainDiscovery";
import { safeUpsertReelsCorpusRows } from "@/lib/factory/reelsBrainCorpusUpsert";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_PAGE_SIZE = 1000;
const MAX_CORPUS_CONTEXT_ROWS = 50000;

const PLATFORM_PROVIDER_ORDER: Record<"tiktok" | "instagram" | "youtube", ReelsBrainProvider[]> = {
  tiktok: ["ensemble_tiktok", "apify_tiktok", "virlo", "apify", "bright_tiktok"],
  instagram: ["apify_instagram", "ensemble_instagram", "bright_instagram"],
  youtube: ["youtube", "apify_youtube", "ensemble_youtube", "bright_youtube"],
};

type BulkProviderRun = {
  niche: string;
  platform: "tiktok" | "instagram" | "youtube";
  provider: ReelsBrainProvider;
  query: string;
  cost_units?: number;
  ok: boolean;
  found?: number;
  normalized?: number;
  inserted?: number;
  enriched?: number;
  rejected?: number;
  elapsed_ms?: number;
  error?: string | null;
};

function providersFor(platform: "tiktok" | "instagram" | "youtube", requested: unknown): ReelsBrainProvider[] {
  if (Array.isArray(requested) && requested.length) {
    return requested
      .map((row) => String(row || "").trim().toLowerCase())
      .filter((row): row is ReelsBrainProvider => hasReelsBrainProvider(row as ReelsBrainProvider));
  }
  const available = new Set(availableReelsBrainProviders());
  return PLATFORM_PROVIDER_ORDER[platform].filter((provider) => available.has(provider));
}

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitList);
  return String(value || "")
    .split(/[\n,]/)
    .map((row) => row.trim())
    .filter(Boolean);
}

function instagramSeeds(body: Record<string, unknown>, req: NextRequest): string[] {
  return Array.from(new Set([
    ...splitList(body.instagram_seeds),
    ...splitList(body.instagram_seed_urls),
    ...splitList(req.nextUrl.searchParams.get("instagram_seeds")),
    ...splitList(req.nextUrl.searchParams.get("instagram_seed_urls")),
    ...splitList(process.env.BRIGHT_DATA_INSTAGRAM_PROFILE_URLS),
  ].filter((url) => /instagram\.com|instagr\.am/i.test(url)))).slice(0, 24);
}

function stableIndex(value: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % length;
}

function isInstagramUrlQuery(query: string): boolean {
  return /instagram\.com|instagr\.am/i.test(query);
}

function normalizedQuery(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function genericInstagramQuery(niche: string): string {
  return normalizedQuery(`${niche} reels`);
}

function isHashtagFriendlyInstagramQuery(query: string): boolean {
  return !/[А-Яа-яЁё]/.test(query);
}

function isRussianSegmentNiche(niche: string): boolean {
  return /^ru[_-]/i.test(niche) || /[А-Яа-яЁё]/.test(niche);
}

function isRussianQuery(query: string): boolean {
  return /[А-Яа-яЁё]/.test(query);
}

function selectLaneQueries(input: {
  lane: ReelsBrainCorpusGrowthLane;
  recommendedQueries: string[];
  queryOverride: string;
  limit: number;
  playbook?: unknown;
  queryCounts?: Map<string, number>;
}, variants: number): string[] {
  if (input.queryOverride) return [input.queryOverride];
  const baseCandidates = input.lane.platform === "instagram" ? input.recommendedQueries.filter((query) => {
    const normalized = normalizedQuery(query);
    if (normalized === genericInstagramQuery(input.lane.niche)) return false;
    if (input.lane.niche === "default" && normalized.startsWith("default ")) return false;
    if (!isRussianSegmentNiche(input.lane.niche) && !isHashtagFriendlyInstagramQuery(query)) return false;
    return true;
  }) : input.recommendedQueries;
  const candidates = baseCandidates.length ? baseCandidates : input.recommendedQueries;
  if (!candidates.length) return [`${input.lane.niche} reels`].slice(0, variants);
  const bucket = Math.floor(Math.max(0, input.lane.current_videos) / Math.max(1, input.limit));
  const stats = new Map(queryLeaderboard(input.playbook, input.lane.platform).map((row) => [normalizedQuery(row.query), row]));
  const scored = candidates.map((query, index) => {
    const key = normalizedQuery(query);
    const stat = stats.get(key);
    const corpusUses = input.queryCounts?.get(key) || 0;
    const saturationPenalty = Math.min(80, corpusUses / Math.max(1, input.limit) * 18);
    const staleBonus = stat?.updated_at ? Math.min(12, Math.max(0, (Date.now() - new Date(stat.updated_at).getTime()) / (24 * 60 * 60 * 1000))) : 8;
    const learnedScore = stat ? stat.score + stat.inserted * 3 - (stat.low_yield_runs || 0) * 25 - (stat.empty_runs || 0) * 30 : 10;
    const rotationBonus = index === bucket % candidates.length ? 6 : 0;
    return {
      query,
      score: learnedScore + staleBonus + rotationBonus - saturationPenalty,
      index,
    };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  return Array.from(new Set(scored.map((row) => row.query))).slice(0, Math.max(1, variants));
}

function prioritizeProvidersForQuery(
  platform: "tiktok" | "instagram" | "youtube",
  query: string,
  providers: ReelsBrainProvider[],
): ReelsBrainProvider[] {
  if (platform === "tiktok" && isRussianQuery(query)) {
    const preferred: ReelsBrainProvider[] = ["virlo", "apify_tiktok", "apify", "ensemble_tiktok"];
    const seen = new Set<ReelsBrainProvider>();
    return [
      ...preferred.filter((provider) => providers.includes(provider) && !seen.has(provider) && seen.add(provider)),
      ...providers.filter((provider) => provider !== "bright_tiktok" && !seen.has(provider) && seen.add(provider)),
      ...providers.filter((provider) => !seen.has(provider) && seen.add(provider)),
    ];
  }
  if (platform !== "instagram") return providers;
  if (!isInstagramUrlQuery(query)) {
    const preferred: ReelsBrainProvider[] = ["apify_instagram", "ensemble_instagram"];
    const seen = new Set<ReelsBrainProvider>();
    return [
      ...preferred.filter((provider) => providers.includes(provider) && !seen.has(provider) && seen.add(provider)),
      ...providers.filter((provider) => provider !== "bright_instagram" && !seen.has(provider) && seen.add(provider)),
      ...providers.filter((provider) => !seen.has(provider) && seen.add(provider)),
    ];
  }
  const preferred: ReelsBrainProvider[] = ["bright_instagram", "ensemble_instagram", "apify_instagram"];
  const seen = new Set<ReelsBrainProvider>();
  return [
    ...preferred.filter((provider) => providers.includes(provider) && !seen.has(provider) && seen.add(provider)),
    ...providers.filter((provider) => !seen.has(provider) && seen.add(provider)),
  ];
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise.finally(() => { if (timer) clearTimeout(timer); }),
    new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]);
}

function diversifiedGrowthQueue(input: {
  lanes: ReelsBrainCorpusGrowthLane[];
  maxLanes: number;
  platforms: ("tiktok" | "instagram" | "youtube")[];
}): ReelsBrainCorpusGrowthLane[] {
  const ordered = buildCorpusGrowthQueue({ lanes: input.lanes, max_lanes: input.lanes.length });
  if (input.platforms.length <= 1) return ordered.slice(0, input.maxLanes);

  const maxPerPlatform = Math.max(1, Math.ceil(input.maxLanes / input.platforms.length));
  const counts = new Map<string, number>();
  const selected: ReelsBrainCorpusGrowthLane[] = [];
  const deferred: ReelsBrainCorpusGrowthLane[] = [];

  for (const lane of ordered) {
    const count = counts.get(lane.platform) || 0;
    if (count < maxPerPlatform && selected.length < input.maxLanes) {
      selected.push(lane);
      counts.set(lane.platform, count + 1);
    } else {
      deferred.push(lane);
    }
  }

  for (const lane of deferred) {
    if (selected.length >= input.maxLanes) break;
    selected.push(lane);
  }
  return selected;
}

async function loadContext(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, niches: string[]) {
  const [{ data: playbooks }, corpusRows] = await Promise.all([
    db.from("niche_playbooks")
      .select("niche,playbook,updated_at")
      .in("niche", niches)
      .order("updated_at", { ascending: false }),
    loadCorpusContextRows(db, niches),
  ]);

  const playbookMap = new Map<string, unknown>();
  for (const row of (playbooks as { niche?: string; playbook?: unknown }[] | null) || []) {
    const niche = String(row.niche || "").trim();
    if (niche && !playbookMap.has(niche)) playbookMap.set(niche, row.playbook);
  }

  const corpusMap = new Map<string, number>();
  const queryCountMap = new Map<string, Map<string, number>>();
  for (const row of (corpusRows as { niche?: string; platform?: string; source_orbit_id?: string | null }[] | null) || []) {
    const niche = String(row.niche || "").trim();
    const platform = String(row.platform || "").trim();
    if (!niche || !platform) continue;
    const key = `${niche}:${platform}`;
    corpusMap.set(key, (corpusMap.get(key) || 0) + 1);

    const source = String(row.source_orbit_id || "");
    const separator = source.indexOf(":");
    const query = separator >= 0 ? source.slice(separator + 1).trim() : "";
    if (!query || query === "manual" || query === "provider") continue;
    const queryKey = normalizedQuery(query);
    if (!queryKey) continue;
    const laneQueries = queryCountMap.get(key) || new Map<string, number>();
    laneQueries.set(queryKey, (laneQueries.get(queryKey) || 0) + 1);
    queryCountMap.set(key, laneQueries);
  }

  return { playbookMap, corpusMap, queryCountMap };
}

async function persistDiscoveryLearning(input: {
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>;
  playbookMap: Map<string, unknown>;
  runs: BulkProviderRun[];
}) {
  const byNiche = new Map<string, BulkProviderRun[]>();
  for (const run of input.runs) {
    if (!run.niche || !run.platform || !run.query) continue;
    const rows = byNiche.get(run.niche) || [];
    rows.push(run);
    byNiche.set(run.niche, rows);
  }

  const results: Array<{ niche: string; learned_sources: number; error?: string }> = [];
  for (const [niche, runs] of byNiche.entries()) {
    let playbook = (input.playbookMap.get(niche) || { niche }) as Record<string, unknown>;
    let learnedSources = 0;
    for (const run of runs) {
      playbook = rememberDiscoverySourceRun(playbook, {
        niche,
        platform: run.platform,
        type: "query",
        value: run.query,
        found: Number(run.found || 0),
        relevant: Number(run.inserted || 0),
        breakout: 0,
        inserted: Number(run.inserted || 0),
        cost_units: Number(run.cost_units || 1),
        reason: `bulk ingest via ${run.provider}`,
      });
      const found = Number(run.found || 0);
      const inserted = Number(run.inserted || 0);
      playbook = rememberQueryPerformance(playbook, {
        query: run.query,
        platform: run.platform,
        found,
        relevant: inserted,
        inserted,
        low_yield: found > 0 && inserted === 0,
        empty_result: found === 0,
        provider_error: Boolean(run.error),
        suppression_hours: run.error ? 12 : found > 0 && inserted === 0 ? 18 : 36,
      });
      learnedSources += 1;
    }

    const { error } = await input.db.from("niche_playbooks").upsert({
      niche,
      playbook: { ...playbook, niche },
      updated_at: new Date().toISOString(),
    }, { onConflict: "niche" });
    results.push(error
      ? { niche, learned_sources: learnedSources, error: error.message }
      : { niche, learned_sources: learnedSources });
  }
  return results;
}

async function loadCorpusContextRows(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>, niches: string[]) {
  const rows: { niche?: string; platform?: string; source_orbit_id?: string | null }[] = [];
  for (let from = 0; from < MAX_CORPUS_CONTEXT_ROWS; from += SUPABASE_PAGE_SIZE) {
    const to = Math.min(from + SUPABASE_PAGE_SIZE - 1, MAX_CORPUS_CONTEXT_ROWS - 1);
    const { data, error } = await db
      .from("viral_videos")
      .select("niche,platform,source_orbit_id")
      .in("niche", niches)
      .range(from, to);
    if (error) throw new Error(error.message);
    const page = (data || []) as { niche?: string; platform?: string; source_orbit_id?: string | null }[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }
  return rows;
}

async function runBulk(req: NextRequest, body: Record<string, unknown>, execute: boolean) {
  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ ok: true, warning: "Supabase не настроен", env: reelsBrainEnvStatus(), queue: [], runs: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const niches = parseAutomationNiches(
    typeof body.niches === "string" ? body.niches : req.nextUrl.searchParams.get("niches"),
    10,
  );
  const platforms = parseAutomationPlatforms(
    typeof body.platforms === "string" ? body.platforms : req.nextUrl.searchParams.get("platforms"),
  ).filter((platform): platform is "tiktok" | "instagram" | "youtube" => platform === "tiktok" || platform === "instagram" || platform === "youtube");
  const maxLanes = Math.max(1, Math.min(6, Number(body.max_lanes || req.nextUrl.searchParams.get("max_lanes") || (execute ? 3 : 6))));
  const limit = Math.max(5, Math.min(50, Number(body.limit || req.nextUrl.searchParams.get("limit") || 25)));
  const providersPerLane = Math.max(1, Math.min(3, Number(body.providers_per_lane || req.nextUrl.searchParams.get("providers_per_lane") || 2)));
  const queryVariantsPerLane = Math.max(1, Math.min(3, Number(body.query_variants_per_lane || req.nextUrl.searchParams.get("query_variants_per_lane") || 1)));
  const timeoutMs = Math.max(5000, Math.min(30000, Number(body.provider_timeout_ms || req.nextUrl.searchParams.get("provider_timeout_ms") || 15000)));
  const budgetLimits = reelsBrainBudgetLimits({
    max_provider_calls: body.max_provider_calls || req.nextUrl.searchParams.get("max_provider_calls"),
    max_cost_units: body.max_cost_units || req.nextUrl.searchParams.get("max_cost_units"),
  });
  const skipUnseededInstagram = body.skip_unseeded_instagram === true || req.nextUrl.searchParams.get("skip_unseeded_instagram") === "true";
  const igSeeds = instagramSeeds(body, req);
  const queryOverride = String(body.query || req.nextUrl.searchParams.get("query") || "").trim().slice(0, 160);

  const { playbookMap, corpusMap, queryCountMap } = await loadContext(db, niches);
  const platformTargets = corpusTargetByPlatform();
  const laneTargets = Object.fromEntries(platforms.map((platform) => [
    platform,
    Math.max(1, Math.ceil(platformTargets[platform] / Math.max(1, niches.length))),
  ])) as Record<"tiktok" | "instagram" | "youtube", number>;

  const lanes: ReelsBrainCorpusGrowthLane[] = niches.flatMap((niche) =>
    platforms.map((platform) => {
      const current = corpusMap.get(`${niche}:${platform}`) || 0;
      const progress = corpusProgress({ current, target: laneTargets[platform] });
      return {
        niche,
        platform,
        current_videos: current,
        corpus_target: progress.target,
        gap: progress.gap,
        progress_pct: progress.progress_pct,
      };
    }),
  );

  const blockedLanes: unknown[] = [];
  const availableLanes = lanes.filter((lane) => {
    const blocked = execute && skipUnseededInstagram && lane.platform === "instagram" && !igSeeds.length;
    if (blocked) {
      blockedLanes.push({
        ...lane,
        reason: "instagram_seed_required",
        fix: "Add BRIGHT_DATA_INSTAGRAM_PROFILE_URLS or pass instagram_seeds/instagram_seed_urls.",
      });
    }
    return !blocked;
  });

  const queue = diversifiedGrowthQueue({ lanes: availableLanes, maxLanes, platforms }).flatMap((lane) => {
    const playbook = playbookMap.get(lane.niche);
    const fallbackQuery = lane.platform === "instagram" ? null : `${lane.niche} reels`;
    const recommendedQueries = nextRecommendedSourceQueries(playbook, lane.niche, lane.platform, fallbackQuery);
    const recommendedQueriesForLane = selectLaneQueries({
      lane,
      recommendedQueries,
      queryOverride,
      limit,
      playbook,
      queryCounts: queryCountMap.get(`${lane.niche}:${lane.platform}`),
    }, queryVariantsPerLane);
    const instagramSeed = lane.platform === "instagram" && igSeeds.length
      ? igSeeds[stableIndex(lane.niche, igSeeds.length)]
      : "";
    const queries = instagramSeed ? [instagramSeed] : recommendedQueriesForLane;
    return queries.map((query, index) => {
      const providers = prioritizeProvidersForQuery(lane.platform, query, providersFor(lane.platform, body.providers));
      return {
        ...lane,
        query,
        query_variant: index + 1,
        query_origin: instagramSeed ? "instagram_seed" : "playbook",
        providers: providers.slice(0, providersPerLane),
        limit,
        provider_timeout_ms: timeoutMs,
      };
    });
  });

  const plannedProviderCalls = queue.flatMap((lane) => lane.providers.map((provider) => provider));
  const budgetPlan = buildReelsBrainBudgetPlan(plannedProviderCalls, budgetLimits);
  const allowedBudgetQueue = [...budgetPlan.decisions];
  const budgetSkipped: unknown[] = [];
  const runs: BulkProviderRun[] = [];
  if (execute) {
    const callQueue = queue.flatMap((lane) =>
      lane.providers.map((provider) => {
        const budgetDecision = allowedBudgetQueue.shift();
        if (!budgetDecision?.allowed) {
          budgetSkipped.push({
            niche: lane.niche,
            platform: lane.platform,
            provider,
            query: lane.query,
            reason: budgetDecision?.reason || "budget_decision_missing",
            cost_units: budgetDecision?.cost_units || null,
          });
          return null;
        }
        return { lane, provider, budgetDecision };
      }),
    ).filter((row): row is NonNullable<typeof row> => row !== null);

    const providerRuns = await Promise.all(callQueue.map(async ({ lane, provider, budgetDecision }) => {
        const started = Date.now();
        const result = await withTimeout(
          fetchReelsBrainProvider(provider, lane.query, lane.limit),
          lane.provider_timeout_ms,
          { provider, query: lane.query, configured: true, elapsedMs: lane.provider_timeout_ms, videos: [], error: "provider timeout" },
        );
        const prepared = makeViralVideoRows(result.videos, {
          niche: lane.niche,
          sourceProvider: provider,
          sourceQuery: lane.query,
          sourceType: "provider",
        });
        let inserted = 0;
        let enriched = 0;
        if (prepared.rows.length) {
          try {
            const write = await safeUpsertReelsCorpusRows({
              db: db as any,
              rows: prepared.rows,
              normalized: prepared.normalized,
              sourceProvider: provider,
              sourceQuery: lane.query,
              sourceType: "provider",
            });
            inserted = write.inserted;
            enriched = write.enriched;
          } catch (error) {
            return {
              niche: lane.niche,
              platform: lane.platform,
              provider,
              query: lane.query,
              ok: false,
              error: String((error as Error)?.message || error),
            };
          }
        }
        return {
          niche: lane.niche,
          platform: lane.platform,
          provider,
          query: lane.query,
          cost_units: budgetDecision.cost_units,
          ok: !result.error,
          found: result.videos.length,
          normalized: prepared.rows.length,
          inserted,
          enriched,
          rejected: prepared.rejected,
          elapsed_ms: Date.now() - started,
          error: result.error || null,
        };
      }));
    runs.push(...providerRuns);
  }
  const automationSummary = summarizeReelsBrainAutomationRuns({
    mode: "bulk",
    strategy: "bulk_raw_ingest",
    platforms,
    runs: runs as Parameters<typeof summarizeReelsBrainAutomationRuns>[0]["runs"],
    ok: true,
  });
  const automation_memory = execute
    ? await persistReelsBrainAutomationRun({ db, niches, summary: automationSummary })
    : { persisted: 0, errors: [] as string[] };
  const discovery_learning = execute
    ? await persistDiscoveryLearning({ db, playbookMap, runs })
    : [];

  console.info("reels_brain_bulk_tick", JSON.stringify({
    execute,
    niches,
    platforms,
    queue: queue.length,
    blocked_lanes: blockedLanes.length,
    budget_skipped: budgetSkipped.length,
    runs: runs.length,
    found: automationSummary.found,
    inserted: automationSummary.inserted,
    enriched: runs.reduce((sum, run) => sum + Number(run.enriched || 0), 0),
    relevant: automationSummary.relevant,
    errors: automationSummary.errors,
    providers: Array.from(new Set(runs.map((run) => run.provider))).slice(0, 12),
    sample: runs.slice(0, 6).map((run) => ({
      niche: run.niche,
      platform: run.platform,
      provider: run.provider,
      query: run.query,
      found: run.found || 0,
      inserted: run.inserted || 0,
      enriched: run.enriched || 0,
      error: run.error || null,
    })),
  }));

  return NextResponse.json({
    ok: true,
    mode: "bulk_raw_ingest",
    execute,
    niches,
    platforms,
    max_lanes: maxLanes,
    limit,
    providers_per_lane: providersPerLane,
    query_variants_per_lane: queryVariantsPerLane,
    query_override: queryOverride || null,
    skip_unseeded_instagram: skipUnseededInstagram,
    instagram_seed_count: igSeeds.length,
    queue,
    blocked_lanes: blockedLanes,
    runs,
    budget: budgetPlan,
    budget_skipped: budgetSkipped,
    automation_summary: automationSummary,
    automation_memory,
    discovery_learning,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const execute = req.nextUrl.searchParams.get("execute") === "true";
  return runBulk(req, {}, execute);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return runBulk(req, body, body.dry_run === true ? false : true);
}
