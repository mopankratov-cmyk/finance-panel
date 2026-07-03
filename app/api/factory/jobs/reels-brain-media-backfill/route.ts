import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { canonicalizeReelsUrl, makeViralVideoRows, type ReelsBrainInput } from "@/lib/factory/reelsBrain";
import { hasYtDlpBinary, resolveMediaLocatorViaYtDlp } from "@/lib/factory/reelsBrainMediaResolver";
import { fetchReelsBrainProvider, hasReelsBrainProvider, type ReelsBrainProvider } from "@/lib/factory/reelsBrainSources";
import { safeUpsertReelsCorpusRows } from "@/lib/factory/reelsBrainCorpusUpsert";
import { parseShardConfig, scoreMediaCandidate, stableShardMatch } from "@/lib/factory/reelsBrainQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type CorpusRow = {
  id: number;
  niche?: string | null;
  platform?: string | null;
  url?: string | null;
  analyzed_full?: unknown;
  created_at?: string | null;
  virality_score?: number | null;
  views?: number | null;
};

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function splitList(value: string): string[] {
  return value.split(",").map((row) => row.trim()).filter(Boolean);
}

function isImageLikeLocator(value: string): boolean {
  const target = value.trim().toLowerCase();
  if (!target) return false;
  return /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|avif)(\?|$)/i.test(target);
}

function isPlayableMediaLocator(value: string): boolean {
  const target = value.trim();
  if (!target) return false;
  if (!/^https?:\/\//i.test(target)) return false;
  return !isImageLikeLocator(target);
}

function hasMediaLocators(row: CorpusRow): boolean {
  const analyzedFull = rec(row.analyzed_full);
  const reelsSeed = rec(analyzedFull.reels_seed);
  const media = Array.isArray(reelsSeed.media_locator_candidates) ? reelsSeed.media_locator_candidates : [];
  return media.some((item) => typeof item === "string" && isPlayableMediaLocator(item));
}

function mediaLocator(video: Record<string, unknown> | null | undefined): string {
  if (!video) return "";
  const candidates = [video.video_url, video.media_url, video.image_url, video.thumbnail];
  for (const item of candidates) {
    if (typeof item === "string" && isPlayableMediaLocator(item)) return item.trim();
  }
  return "";
}

function numberParam(req: NextRequest, name: string, fallback: number, min: number, max: number): number {
  const value = Number(req.nextUrl.searchParams.get(name) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function providerParam(req: NextRequest): ReelsBrainProvider {
  const raw = String(req.nextUrl.searchParams.get("provider") || "apify_instagram").trim().toLowerCase();
  return raw as ReelsBrainProvider;
}

function sameCanonical(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false;
  return canonicalizeReelsUrl(a).canonicalUrl === canonicalizeReelsUrl(b).canonicalUrl;
}

function effectiveProviderForQuery(provider: ReelsBrainProvider, query: string): ReelsBrainProvider {
  if (
    /instagram\.com\/p\//i.test(query)
    && (provider === "bright_instagram" || provider === "apify_instagram")
    && hasReelsBrainProvider("bright_instagram_post")
  ) {
    return "bright_instagram_post";
  }
  return provider;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

    const provider = providerParam(req);
    if (!hasReelsBrainProvider(provider)) {
      return NextResponse.json({ error: `${provider} не настроен` }, { status: 503 });
    }

    const niches = splitList(req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    const limit = numberParam(req, "limit", 3, 1, 6);
    const scan = numberParam(req, "scan", 120, limit, 500);
    const platform = String(req.nextUrl.searchParams.get("platform") || "instagram").trim().toLowerCase();
    const allowLocalResolver = String(req.nextUrl.searchParams.get("use_local_resolver") || process.env.REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER || "").toLowerCase() === "1";
    const ytDlpAvailable = allowLocalResolver ? await hasYtDlpBinary() : false;

    const { data, error } = await db
      .from("viral_videos")
      .select("id,niche,platform,url,analyzed_full,created_at,virality_score,views")
      .in("niche", niches)
      .eq("platform", platform)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(scan);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const priorityMode = String(req.nextUrl.searchParams.get("priority") || "smart").trim().toLowerCase();
    const { shardIndex, shardCount } = parseShardConfig({
      shardIndex: req.nextUrl.searchParams.get("shard_index"),
      shardCount: req.nextUrl.searchParams.get("shard_count"),
    });

    const corpusRows = ((data || []) as CorpusRow[])
      .filter((row) => stableShardMatch(row.id, shardIndex, shardCount))
      .filter((row) => row.url && !hasMediaLocators(row))
      .map((row) => ({
        row,
        priority: priorityMode === "fifo"
          ? 0
          : scoreMediaCandidate({
            id: row.id,
            viralityScore: row.virality_score,
            views: row.views,
            createdAt: row.created_at,
            hasPageFallback: /instagram\.com\/(reel|reels|tv|p)\//i.test(String(row.url || "")),
          }),
      }))
      .sort((a, b) =>
        b.priority - a.priority
        || Number(b.row.virality_score || 0) - Number(a.row.virality_score || 0)
        || Number(b.row.views || 0) - Number(a.row.views || 0)
        || Number(b.row.id || 0) - Number(a.row.id || 0),
      )
      .map((entry) => entry.row)
      .slice(0, limit);

    const runs: Array<Record<string, unknown>> = [];
    let inserted = 0;
    let enriched = 0;
    let withMedia = 0;

    for (const row of corpusRows) {
      const query = String(row.url || "");
      const effectiveProvider = effectiveProviderForQuery(provider, query);
      const result = await fetchReelsBrainProvider(effectiveProvider, query, 6);
      const matched = result.videos.filter((video) => sameCanonical(video.url, query));
      let mediaReady = matched.filter((video) => mediaLocator(video as Record<string, unknown>));
      let resolverSample: Record<string, unknown> | null = null;

      if (!mediaReady.length && ytDlpAvailable) {
        const resolved = await resolveMediaLocatorViaYtDlp(query);
        if (resolved?.media_url) {
          resolverSample = resolved;
          const base = matched[0] || result.videos[0] || { url: query, platform, caption: "" };
          matched.unshift({
            ...base,
            url: query,
            video_url: resolved.media_url,
            author: base.author || resolved.author || undefined,
            duration_sec: base.duration_sec || resolved.duration_sec || undefined,
            title: base.title || resolved.title || undefined,
          });
          mediaReady = matched.filter((video) => mediaLocator(video as Record<string, unknown>));
        }
      }

      if (mediaReady.length) withMedia += 1;

      if (matched.length) {
        const prepared = makeViralVideoRows(matched as ReelsBrainInput[], {
          niche: String(row.niche || "default"),
          sourceProvider: effectiveProvider,
          sourceQuery: query,
          sourceType: "provider",
        });
        if (prepared.rows.length) {
          const write = await safeUpsertReelsCorpusRows({
            db: db as any,
            rows: prepared.rows,
            normalized: prepared.normalized,
            sourceProvider: effectiveProvider,
            sourceQuery: query,
            sourceType: "provider",
          });
          inserted += write.inserted;
          enriched += write.enriched;
        }
      }

      runs.push({
        id: row.id,
        niche: row.niche,
        url: query,
        provider,
        effective_provider: effectiveProvider,
        found: result.videos.length,
        matched: matched.length,
        matched_with_media: mediaReady.length,
        used_local_resolver: Boolean(resolverSample?.media_url),
        resolver_sample: resolverSample,
        sample_found: result.videos[0]
          ? {
            url: result.videos[0].url || null,
            video_url: result.videos[0].video_url || null,
            media_url: mediaLocator(result.videos[0] as Record<string, unknown>) || null,
            author: result.videos[0].author || null,
            duration_sec: result.videos[0].duration_sec || null,
            platform: result.videos[0].platform || null,
          }
          : null,
        sample_matched: matched[0]
          ? {
            url: matched[0].url || null,
            video_url: matched[0].video_url || null,
            media_url: mediaLocator(matched[0] as Record<string, unknown>) || null,
            author: matched[0].author || null,
            duration_sec: matched[0].duration_sec || null,
            platform: matched[0].platform || null,
          }
          : null,
        error: result.error || null,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "reels_brain_media_backfill",
      provider,
      platform,
      local_resolver_enabled: allowLocalResolver,
      local_resolver_available: ytDlpAvailable,
      shard_index: shardIndex,
      shard_count: shardCount,
      priority: priorityMode,
      scanned: scan,
      attempted: corpusRows.length,
      rows_with_media: withMedia,
      inserted,
      enriched,
      runs,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: "reels-brain-media-backfill crash: " + String((error as Error)?.message || error).slice(0, 180),
    }, { status: 500 });
  }
}
