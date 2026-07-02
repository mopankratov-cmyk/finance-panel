import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { makeViralVideoRows } from "@/lib/factory/reelsBrain";
import {
  availableReelsBrainProviders,
  fetchReelsBrainProvider,
  filterRelevantReelsInputs,
  hasReelsBrainProvider,
  knownReelsBrainProviders,
  pickBestBakeOffProvider,
  pickBestBakeOffProviderByPlatform,
  rankBakeOffProviders,
  summarizeProviderQuality,
  type ProviderQualitySummary,
  type ProviderPlatformBakeOffAggregate,
  type RankedProvider,
  type ReelsBrainProvider,
} from "@/lib/factory/reelsBrainSources";
import { normalizeTargetPlatform, preferredSourceProvider, rememberSourceProvider } from "@/lib/factory/reelsBrainPlaybook";
import { safeUpsertReelsCorpusRows } from "@/lib/factory/reelsBrainCorpusUpsert";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KNOWN_PROVIDERS = new Set<string>(knownReelsBrainProviders());
const PROVIDER_TIMEOUT_MS = 20_000;
const BAKE_OFF_CONCURRENCY = 6;

interface BakeOffRun {
  provider: ReelsBrainProvider;
  query: string;
  configured: boolean;
  elapsed_ms: number;
  error: string | null;
  inserted?: number;
  enriched?: number;
  quality: ProviderQualitySummary;
}

interface BakeOffTask {
  provider: ReelsBrainProvider;
  query: string;
}

function costTierForProvider(provider: ReelsBrainProvider): "low" | "medium" | "high" {
  if (provider.startsWith("apify") || provider === "youtube") return "low";
  if (provider.startsWith("ensemble")) return "medium";
  return "high";
}

function stableBestProvider(ranked: RankedProvider[], preferred: ReelsBrainProvider | null): { winner: RankedProvider | null; confidence: number } {
  const first = ranked[0] || null;
  const second = ranked[1] || null;
  if (!first) return { winner: null, confidence: 0 };
  const confidence = Math.max(0, Math.round((Number(first.rank_score || 0) - Number(second?.rank_score || 0)) * 10) / 10);
  if (preferred && second && confidence < 30) {
    const preferredRow = ranked.find((row) => row.provider === preferred) || null;
    if (preferredRow && preferredRow.valid > 0 && preferredRow.relevant > 0) {
      return { winner: preferredRow, confidence };
    }
  }
  return { winner: first, confidence };
}

function platformTotalsFromRuns(runs: BakeOffRun[], provider: ReelsBrainProvider, platform: "tiktok" | "instagram" | "youtube"): ProviderPlatformBakeOffAggregate {
  const providerRuns = runs.filter((run) => run.provider === provider);
  let found = 0;
  let valid = 0;
  let relevant = 0;
  let avgScoreSum = 0;
  let withFollowers = 0;
  let withSound = 0;
  let elapsedMs = 0;
  let timeoutRuns = 0;
  let failedRuns = 0;

  for (const run of providerRuns) {
    const stats = run.quality.platformStats[platform];
    if (!stats) continue;
    found += stats.found;
    valid += stats.valid;
    relevant += stats.relevant;
    avgScoreSum += stats.avgScore * stats.valid;
    withFollowers += stats.withFollowers;
    withSound += stats.withSound;
    elapsedMs += Number(run.elapsed_ms || 0);
    if (run.error?.includes("timeout after")) timeoutRuns += 1;
    if (run.error) failedRuns += 1;
  }

  return {
    provider,
    platform,
    configured: hasReelsBrainProvider(provider),
    runs: providerRuns.length,
    found,
    valid,
    valid_rate: found ? Math.round(valid / found * 100) / 100 : 0,
    relevant,
    relevance_rate: found ? Math.round(relevant / found * 100) / 100 : 0,
    avg_score: valid ? Math.round(avgScoreSum / valid * 10) / 10 : 0,
    with_followers: withFollowers,
    with_sound: withSound,
    avg_elapsed_ms: providerRuns.length ? Math.round(elapsedMs / providerRuns.length) : 0,
    timeout_runs: timeoutRuns,
    failed_runs: failedRuns,
    cost_tier: costTierForProvider(provider),
  };
}

function providersFromBody(value: unknown): ReelsBrainProvider[] {
  if (!Array.isArray(value) || !value.length) return availableReelsBrainProviders();
  const out = value
    .map((p) => String(p || "").trim().toLowerCase())
    .filter((p): p is ReelsBrainProvider => KNOWN_PROVIDERS.has(p));
  return Array.from(new Set(out));
}

function queriesFromBody(body: Record<string, unknown>): string[] {
  if (Array.isArray(body.queries)) {
    const q = body.queries.map((x) => String(x || "").trim()).filter(Boolean);
    if (q.length) return Array.from(new Set(q)).slice(0, 12);
  }
  const one = String(body.query || body.niche || "").trim();
  return one ? [one] : [];
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const width = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: width }, () => consume()));
  return results;
}

async function runBakeOffTask(
  task: BakeOffTask,
  niche: string,
  limit: number,
  persist: boolean,
  db: ReturnType<typeof getSupabaseAdmin>,
): Promise<BakeOffRun> {
  const { provider, query } = task;
  if (!hasReelsBrainProvider(provider)) {
    return {
      provider,
      query,
      configured: false,
      elapsed_ms: 0,
      quality: summarizeProviderQuality(provider, query, []),
      error: `${provider} не настроен`,
      inserted: 0,
    };
  }

  const result = await withTimeout(
    fetchReelsBrainProvider(provider, query, limit),
    PROVIDER_TIMEOUT_MS,
    `${provider}:${query}`,
  ).catch((error) => ({
    provider,
    query,
    configured: true,
    elapsedMs: PROVIDER_TIMEOUT_MS,
    videos: [],
    error: String((error as Error)?.message || error).slice(0, 220),
  }));

  const quality = summarizeProviderQuality(provider, query, result.videos);
  let inserted = 0;
  let enriched = 0;

  if (persist && db && result.videos.length) {
    const relevantVideos = filterRelevantReelsInputs(query, result.videos);
    const prepared = makeViralVideoRows(relevantVideos, {
      niche,
      sourceProvider: provider,
      sourceQuery: query,
      sourceType: "provider",
    });
    if (prepared.rows.length) {
      const write = await safeUpsertReelsCorpusRows({
        db: db as any,
        rows: prepared.rows,
        normalized: prepared.normalized,
        sourceProvider: provider,
        sourceQuery: query,
        sourceType: "provider",
      });
      inserted = write.inserted;
      enriched = write.enriched;
    }
  }

  return {
    provider,
    query,
    configured: result.configured,
    elapsed_ms: result.elapsedMs,
    error: result.error || null,
    inserted,
    enriched,
    quality,
  };
}

// POST { niche, queries?, providers?, limit?, persist? }
// Report-only provider bake-off by default. persist=true writes normalized rows to viral_videos.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const niche = String(body.niche || "default").trim() || "default";
    const queries = queriesFromBody(body);
    if (!queries.length) return NextResponse.json({ error: "нужен query, niche или queries[]" }, { status: 400 });
    const limit = Math.min(50, Math.max(1, Number(body.limit || 20)));
    const persist = body.persist === true;
    const persistMemory = body.persist_memory === true;
    const targetPlatform = normalizeTargetPlatform(body.target_platform || body.platform);
    const providers = providersFromBody(body);
    if (!providers.length) {
      return NextResponse.json({
        ok: true,
        niche,
        queries,
        providers: [],
        warning: "нет настроенных провайдеров: нужны VIRLO_API_KEY, APIFY_TOKEN, YOUTUBE_API_KEY, BRIGHT_DATA_API_KEY или ENSEMBLEDATA_API_KEY",
      });
    }

    if (persist && !getSupabaseAdmin()) return NextResponse.json({ error: "persist=true требует Supabase" }, { status: 500 });
    const db = persist ? getSupabaseAdmin() : null;
    const playbookDb = getSupabaseAdmin();
    let playbookRow: unknown = null;
    if (playbookDb) {
      try {
        const result = await playbookDb
          .from("niche_playbooks")
          .select("playbook")
          .eq("niche", niche)
          .order("updated_at", { ascending: false })
          .limit(1);
        playbookRow = ((result.data as { playbook?: unknown }[] | null)?.[0]?.playbook || null) as unknown;
      } catch {
        playbookRow = null;
      }
    }
    const preferredProvider = preferredSourceProvider(playbookRow, targetPlatform);
    const tasks = queries.flatMap((query) => providers.map((provider) => ({ provider, query })));
    const runs = await mapLimit(tasks, BAKE_OFF_CONCURRENCY, (task) => runBakeOffTask(task, niche, limit, persist, db));
    const persisted = runs.reduce((sum, run) => sum + (run.inserted || 0), 0);
    const timeoutRuns = runs.filter((run) => run.error?.includes("timeout after")).length;
    const failedRuns = runs.filter((run) => !!run.error).length;

    const summaryByProvider = providers.map((provider) => {
      const providerRuns = runs.filter((r) => r.provider === provider);
      const found = providerRuns.reduce((sum, r) => sum + r.quality.found, 0);
      const valid = providerRuns.reduce((sum, r) => sum + r.quality.valid, 0);
      const relevant = providerRuns.reduce((sum, r) => sum + r.quality.relevant, 0);
      const failedRuns = providerRuns.filter((r) => !!r.error).length;
      const timeoutRuns = providerRuns.filter((r) => r.error?.includes("timeout after")).length;
      return {
        provider,
        configured: hasReelsBrainProvider(provider),
        runs: providerRuns.length,
        found,
        valid,
        valid_rate: found ? Math.round(valid / found * 100) / 100 : 0,
        relevant,
        relevance_rate: found ? Math.round(relevant / found * 100) / 100 : 0,
        avg_score: providerRuns.length ? Math.round(providerRuns.reduce((sum, r) => sum + r.quality.avgScore, 0) / providerRuns.length * 10) / 10 : 0,
        with_followers: providerRuns.reduce((sum, r) => sum + r.quality.withFollowers, 0),
        with_sound: providerRuns.reduce((sum, r) => sum + r.quality.withSound, 0),
        avg_elapsed_ms: providerRuns.length ? Math.round(providerRuns.reduce((sum, r) => sum + Number(r.elapsed_ms || 0), 0) / providerRuns.length) : 0,
        timeout_runs: timeoutRuns,
        failed_runs: failedRuns,
        cost_tier: costTierForProvider(provider),
      };
    });
    const rankedProviders = rankBakeOffProviders(summaryByProvider);
    const bestProvider = pickBestBakeOffProvider(summaryByProvider);
    const stableBest = stableBestProvider(rankedProviders, preferredProvider);
    const summaryByProviderPlatform = providers.flatMap((provider) =>
      (["tiktok", "instagram", "youtube"] as const).map((platform) => platformTotalsFromRuns(runs, provider, platform))
    );
    const rankedByPlatform = Object.fromEntries(
      (["tiktok", "instagram", "youtube"] as const).map((platform) => [
        platform,
        rankBakeOffProviders(summaryByProviderPlatform.filter((row) => row.platform === platform)),
      ]),
    );
    const bestProviderByPlatform = pickBestBakeOffProviderByPlatform(summaryByProviderPlatform);
    const stableBestByPlatform = Object.fromEntries(
      (["tiktok", "instagram", "youtube"] as const).map((platform) => [
        platform,
        stableBestProvider(
          rankedByPlatform[platform] as RankedProvider[],
          preferredSourceProvider(playbookRow, platform),
        ),
      ]),
    ) as Record<"tiktok" | "instagram" | "youtube", { winner: RankedProvider | null; confidence: number }>;
    const bestPlatformProvider = targetPlatform === "instagram" || targetPlatform === "youtube"
      ? stableBestByPlatform[targetPlatform].winner
      : stableBestByPlatform.tiktok.winner;
    let sourceMemoryUpdated = false;
    if (persistMemory && bestPlatformProvider) {
      try {
        const { data: existing } = await getSupabaseAdmin()
          ?.from("niche_playbooks")
          .select("playbook")
          .eq("niche", niche)
          .order("updated_at", { ascending: false })
          .limit(1) || { data: null };
        const current = ((existing as { playbook?: Record<string, unknown> }[] | null)?.[0]?.playbook || { niche }) as Record<string, unknown>;
        const playbook = rememberSourceProvider(current, targetPlatform, {
          provider: bestPlatformProvider.provider,
          source: "bake-off",
          runs: bestPlatformProvider.runs,
          found: bestPlatformProvider.found,
          valid: bestPlatformProvider.valid,
          relevant: bestPlatformProvider.relevant,
          avg_score: bestPlatformProvider.avg_score,
        });
        const { error: upErr } = await getSupabaseAdmin()
          ?.from("niche_playbooks")
          .upsert({ niche, playbook, updated_at: new Date().toISOString() }, { onConflict: "niche" }) || { error: null };
        sourceMemoryUpdated = !upErr;
      } catch { /* source memory is best-effort */ }
    }

    return NextResponse.json({
      ok: true,
      niche,
      queries,
      limit,
      persist,
      persist_memory: persistMemory,
      target_platform: targetPlatform,
      persisted,
      providers,
      warning: timeoutRuns
        ? `${timeoutRuns} run(s) превысили ${Math.round(PROVIDER_TIMEOUT_MS / 1000)}s и были обрезаны; сводка может быть частичной`
        : failedRuns
          ? `${failedRuns} run(s) вернулись с ошибкой; проверь построчный результат`
          : undefined,
      summary_by_provider: summaryByProvider,
      summary_by_provider_platform: summaryByProviderPlatform,
      ranked_providers: rankedProviders,
      ranked_by_platform: rankedByPlatform,
      best_provider: bestProvider,
      stable_best_provider: stableBest.winner,
      stable_best_confidence: stableBest.confidence,
      best_provider_by_platform: bestProviderByPlatform,
      stable_best_provider_by_platform: Object.fromEntries(
        Object.entries(stableBestByPlatform).map(([platform, row]) => [platform, row.winner]),
      ),
      stable_best_confidence_by_platform: Object.fromEntries(
        Object.entries(stableBestByPlatform).map(([platform, row]) => [platform, row.confidence]),
      ),
      source_memory_updated: sourceMemoryUpdated,
      runs,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "bake-off reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
