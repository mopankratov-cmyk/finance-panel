import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  availableTrendProviders,
  fetchViralFromProvider,
  hasTrendProvider,
  hasTrendSource,
  prioritizeTrendProviders,
  type TrendProvider,
} from "@/lib/factory/trendSources";
import { makeViralVideoRows, type ReelsBrainInput } from "@/lib/factory/reelsBrain";
import {
  recoverableSourceQueries,
  nextRecommendedSourceQueries,
  nextRecommendedSourceQuery,
  normalizeShortPlatform,
  preferredSourceProvider,
  rememberIncident,
  rememberQueryPerformance,
  rememberSourceProvider,
  suppressedSourceQueries,
  sourceProviderHistory,
  sourceRelearnPolicy,
} from "@/lib/factory/reelsBrainPlaybook";
import { filterRelevantReelsInputs, pickBestBakeOffProvider, summarizeProviderQuality, type ReelsBrainProvider } from "@/lib/factory/reelsBrainSources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KNOWN_TREND_PROVIDERS = new Set<TrendProvider>(["apify_tiktok", "apify_instagram", "apify_youtube", "virlo", "apify"]);

interface ProviderRunSummary {
  provider: TrendProvider;
  found: number;
  relevant: number;
  normalized: number;
  rejected: number;
  quality: ReturnType<typeof summarizeProviderQuality>;
}

function moveProviderToFront<T extends string>(rows: T[], preferred: T | null): T[] {
  if (!preferred || !rows.includes(preferred)) return rows;
  return [preferred, ...rows.filter((row) => row !== preferred)];
}

function bestProviderForPlatform(providerRuns: ProviderRunSummary[], targetPlatform: "tiktok" | "instagram" | "youtube") {
  return pickBestBakeOffProvider(providerRuns.map((run) => {
    const stats = run.quality.platformStats[targetPlatform];
    return {
      provider: run.provider as ReelsBrainProvider,
      configured: true,
      runs: 1,
      found: stats?.found || 0,
      valid: stats?.valid || 0,
      valid_rate: (stats?.found || 0) ? Math.round((stats?.valid || 0) / (stats?.found || 1) * 100) / 100 : 0,
      relevant: stats?.relevant || 0,
      relevance_rate: (stats?.found || 0) ? Math.round((stats?.relevant || 0) / (stats?.found || 1) * 100) / 100 : 0,
      avg_score: stats?.avgScore || 0,
      with_followers: stats?.withFollowers || 0,
      with_sound: stats?.withSound || 0,
    };
  }));
}

function providerList(body: Record<string, unknown>): TrendProvider[] {
  if (!Array.isArray(body.providers) || !body.providers.length) return availableTrendProviders();
  const selected = body.providers
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value): value is TrendProvider => KNOWN_TREND_PROVIDERS.has(value as TrendProvider) && hasTrendProvider(value as TrendProvider));
  return Array.from(new Set(selected));
}

function toInputs(provider: TrendProvider, videos: Awaited<ReturnType<typeof fetchViralFromProvider>>): ReelsBrainInput[] {
  return videos.map((v): ReelsBrainInput => ({
    url: v.url,
    video_url: v.video_url,
    download_url: v.download_url,
    media_url: v.media_url,
    audio_url: v.audio_url,
    thumbnail_url: v.thumbnail_url,
    platform: v.platform || (provider === "virlo" ? "tiktok" : undefined),
    caption: v.caption || v.title,
    title: v.title,
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    shares: v.shares,
    followers: v.followers,
    sound_id: v.sound_id,
    sound_title: v.sound_title,
    published_at: v.published_at,
  }));
}

async function withProviderTimeout(provider: TrendProvider, query: string, limit: number, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      fetchViralFromProvider(provider, query, limit),
      new Promise<Awaited<ReturnType<typeof fetchViralFromProvider>>>((resolve) => {
        timer = setTimeout(() => resolve([]), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// POST { niche, query?, limit? }
// Универсальный Source Runner: пробует primary provider и fallback-цепочку, затем пишет clean rows в viral_videos.
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    if (!hasTrendSource()) return NextResponse.json({ error: "источник трендов не настроен: нужен APIFY_TOKEN или VIRLO_API_KEY" }, { status: 503 });

    const body = await req.json().catch(() => ({}));
    const niche = String(body.niche || "default").trim() || "default";
    const limit = Math.min(100, Math.max(1, Number(body.limit || 30)));
    const targetPlatform = normalizeShortPlatform(body.target_platform || body.platform);
    let playbook: Record<string, unknown> | null = null;
    try {
      const { data } = await db.from("niche_playbooks").select("playbook").eq("niche", niche).order("updated_at", { ascending: false }).limit(1);
      playbook = ((data as { playbook?: Record<string, unknown> }[] | null)?.[0]?.playbook || null) as Record<string, unknown> | null;
    } catch { /* no cached playbook */ }
    const recommendedQueries = nextRecommendedSourceQueries(playbook, niche, targetPlatform, body.query ? String(body.query) : null);
    const suppressedQueries = suppressedSourceQueries(playbook, targetPlatform).slice(0, 8);
    const recoveryQueries = recoverableSourceQueries(playbook, targetPlatform).slice(0, 5);
    const query = String(body.query || nextRecommendedSourceQuery(playbook, niche, targetPlatform, recommendedQueries[0]) || niche).trim().slice(0, 120);
    const relearnPolicy = sourceRelearnPolicy(playbook, targetPlatform);
    const rememberedProvider = preferredSourceProvider(playbook, targetPlatform);
    const providerHint = String(body.provider_hint || "").trim().toLowerCase();
    let providers = prioritizeTrendProviders(targetPlatform, providerList(body));
    if (providerHint && hasTrendProvider(providerHint as TrendProvider)) {
      providers = moveProviderToFront(providers, providerHint as TrendProvider);
    }
    providers = moveProviderToFront(
      providers,
      !providerHint && rememberedProvider && hasTrendProvider(rememberedProvider as TrendProvider)
        ? rememberedProvider as TrendProvider
        : null,
    );
    if (!providers.length) {
      return NextResponse.json({ error: "нет доступных trend providers для source-run" }, { status: 503 });
    }
    const providerLimit = Math.min(providers.length, Math.max(1, Number(body.provider_limit || providers.length)));
    const providerTimeoutMs = Math.min(45000, Math.max(5000, Number(body.provider_timeout_ms || 22000)));
    providers = providers.slice(0, providerLimit);

    const allInputs: ReelsBrainInput[] = [];
    const providerRuns: ProviderRunSummary[] = [];
    const seenUrls = new Set<string>();

    for (const provider of providers) {
      const remaining = Math.max(limit - allInputs.length, 1);
      const videos = await withProviderTimeout(provider, query, remaining, providerTimeoutMs);
      const inputs = toInputs(provider, videos);
      const relevantInputs = filterRelevantReelsInputs(query, inputs);
      const freshRelevant = relevantInputs.filter((input) => {
        const key = String(input.url || "").trim();
        if (!key) return true;
        if (seenUrls.has(key)) return false;
        seenUrls.add(key);
        return true;
      });
      const preparedPreview = makeViralVideoRows(freshRelevant, {
        niche,
        sourceProvider: provider,
        sourceQuery: query,
        sourceType: "provider",
      });

      providerRuns.push({
        provider,
        found: videos.length,
        relevant: freshRelevant.length,
        normalized: preparedPreview.rows.length,
        rejected: preparedPreview.rejected,
        quality: summarizeProviderQuality(provider as ReelsBrainProvider, query, inputs),
      });

      allInputs.push(...freshRelevant);
      if (allInputs.length >= limit) break;
    }

    const provider = providerRuns.find((run) => run.normalized > 0 || run.relevant > 0 || run.found > 0)?.provider || providers[0];
    const learned = bestProviderForPlatform(providerRuns, targetPlatform);
    const finalInputs = allInputs.slice(0, limit);
    const prepared = makeViralVideoRows(finalInputs, { niche, sourceProvider: provider, sourceQuery: query, sourceType: "provider" });

    let inserted = 0;
    if (prepared.rows.length) {
      const { error, count } = await db
        .from("viral_videos")
        .upsert(prepared.rows, { onConflict: "url", ignoreDuplicates: true, count: "exact" });
      if (error) return NextResponse.json({ error: "viral_videos: " + error.message }, { status: 500 });
      inserted = count ?? prepared.rows.length;
    }

    let learnedProvider: string | null = learned?.provider || null;
    let memoryUpdated = false;
    let nextPlaybook = playbook || { niche };
    nextPlaybook = rememberQueryPerformance(nextPlaybook, {
      query,
      platform: targetPlatform,
      found: providerRuns.reduce((sum, run) => sum + run.found, 0),
      relevant: finalInputs.length,
      inserted,
      low_yield: finalInputs.length > 0 && finalInputs.length < relearnPolicy.min_relevant,
      empty_result: finalInputs.length < 1,
      suppression_hours: finalInputs.length < 1 ? 48 : 24,
    });
    if (learned && learnedProvider) {
      try {
        nextPlaybook = rememberSourceProvider(nextPlaybook, targetPlatform, {
          provider: learnedProvider as ReelsBrainProvider,
          source: "source-run",
          runs: providerRuns.length,
          found: learned.found,
          valid: learned.valid,
          relevant: learned.relevant,
          avg_score: learned.avg_score,
        });
        if (rememberedProvider && learnedProvider !== rememberedProvider) {
          nextPlaybook = rememberIncident(nextPlaybook, {
            platform: targetPlatform,
            severity: "watch",
            kind: "provider_drift",
            message: `provider drift: ${rememberedProvider} -> ${learnedProvider}`,
            niche,
            provider: learnedProvider,
            query,
            cooldown_hours: 24,
          });
        }
      } catch { /* source memory is best-effort */ }
    }
    if (finalInputs.length < relearnPolicy.min_relevant) {
      nextPlaybook = rememberIncident(nextPlaybook, {
        platform: targetPlatform,
        severity: finalInputs.length < 1 ? "critical" : "watch",
        kind: finalInputs.length < 1 ? "empty_intake" : "low_yield",
        message: finalInputs.length < 1
          ? `empty intake for ${query}`
          : `low yield for ${query}: relevant=${finalInputs.length}, inserted=${inserted}`,
        niche,
        provider: learnedProvider || provider,
        query,
        cooldown_hours: finalInputs.length < 1 ? 12 : 6,
      });
    }
    try {
      const { error: upErr } = await db.from("niche_playbooks").upsert({
        niche,
        playbook: nextPlaybook,
        updated_at: new Date().toISOString(),
      }, { onConflict: "niche" });
      memoryUpdated = !upErr;
    } catch { /* playbook updates are best-effort */ }

    if (memoryUpdated) {
      playbook = nextPlaybook;
    }

    return NextResponse.json({
      ok: true,
      provider,
      providers_tried: providers,
      provider_hint: providerHint || null,
      remembered_provider: rememberedProvider,
      learned_provider: learnedProvider,
      source_memory_updated: memoryUpdated,
      relearn_policy: relearnPolicy,
      recommended_queries: recommendedQueries,
      suppressed_queries: suppressedQueries,
      recovery_queries: recoveryQueries,
      source_provider_history: sourceProviderHistory(playbook, targetPlatform).slice(0, 8),
      target_platform: targetPlatform,
      niche,
      query,
      requested: limit,
      found: providerRuns.reduce((sum, run) => sum + run.found, 0),
      relevant: finalInputs.length,
      normalized: prepared.rows.length,
      inserted,
      rejected: prepared.rejected,
      quality: summarizeProviderQuality(provider as ReelsBrainProvider, query, finalInputs),
      provider_runs: providerRuns,
      sample: prepared.rows.slice(0, 8).map((r) => ({ url: r.url, views: r.views, score: r.virality_score })),
    });
  } catch (e) {
    return NextResponse.json({ error: "source-run reels-brain упал: " + String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
}
