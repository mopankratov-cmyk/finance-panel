import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { makeViralVideoRows } from "@/lib/factory/reelsBrain";
import {
  availableReelsBrainProviders,
  fetchReelsBrainProvider,
  filterRelevantReelsInputs,
  hasReelsBrainProvider,
  knownReelsBrainProviders,
  summarizeProviderQuality,
  type ProviderQualitySummary,
  type ReelsBrainProvider,
} from "@/lib/factory/reelsBrainSources";

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
  quality: ProviderQualitySummary;
}

interface BakeOffTask {
  provider: ReelsBrainProvider;
  query: string;
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

  if (persist && db && result.videos.length) {
    const relevantVideos = filterRelevantReelsInputs(query, result.videos);
    const prepared = makeViralVideoRows(relevantVideos, {
      niche,
      sourceProvider: provider,
      sourceQuery: query,
      sourceType: "provider",
    });
    if (prepared.rows.length) {
      const { count } = await db
        .from("viral_videos")
        .upsert(prepared.rows, { onConflict: "url", ignoreDuplicates: true, count: "exact" });
      inserted = count ?? prepared.rows.length;
    }
  }

  return {
    provider,
    query,
    configured: result.configured,
    elapsed_ms: result.elapsedMs,
    error: result.error || null,
    inserted,
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
      };
    });

    return NextResponse.json({
      ok: true,
      niche,
      queries,
      limit,
      persist,
      persisted,
      providers,
      warning: timeoutRuns
        ? `${timeoutRuns} run(s) превысили ${Math.round(PROVIDER_TIMEOUT_MS / 1000)}s и были обрезаны; сводка может быть частичной`
        : failedRuns
          ? `${failedRuns} run(s) вернулись с ошибкой; проверь построчный результат`
          : undefined,
      summary_by_provider: summaryByProvider,
      runs,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: "bake-off reels-brain упал: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
