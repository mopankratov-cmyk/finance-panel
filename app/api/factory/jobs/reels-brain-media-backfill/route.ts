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

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
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

function isDirectVideoLocator(value: string): boolean {
  const target = value.trim();
  if (!target) return false;
  if (isImageLikeLocator(target)) return false;
  if (/\.(mp4|m4v|mov|webm|m3u8)(\?|$)/i.test(target)) return true;
  if (/mime_type=video_|video_mp4|\/video\/|\/videoplayback\b|\.googlevideo\.com\//i.test(target)) return true;
  return false;
}

function hasResolvedMediaLocators(row: CorpusRow): boolean {
  const analyzedFull = rec(row.analyzed_full);
  const reelsSeed = rec(analyzedFull.reels_seed);
  const media = Array.isArray(reelsSeed.media_locator_candidates) ? reelsSeed.media_locator_candidates : [];
  return media.some((item) => typeof item === "string" && isDirectVideoLocator(item));
}

function hasTerminalMediaFailure(row: CorpusRow): boolean {
  const analyzedFull = rec(row.analyzed_full);
  const reelsSeed = rec(analyzedFull.reels_seed);
  const pipeline = rec(reelsSeed.pipeline);
  const lastError = String(pipeline.last_error || "").trim().toLowerCase();
  return lastError === "media_locator_unresolved"
    || lastError.includes("moov atom not found")
    || lastError.includes("invalid data found when processing input")
    || lastError.includes("audio_stream_not_found");
}

function markMediaLocatorUnresolved(existing: unknown) {
  const current = rec(existing);
  const currentSeed = rec(current.reels_seed);
  const currentPipeline = rec(currentSeed.pipeline);
  const currentAttempts = rec(currentPipeline.attempts);
  const now = new Date().toISOString();
  const currentMediaAttempts = Number(currentAttempts.media);

  return {
    ...current,
    reels_seed: {
      ...currentSeed,
      pipeline: {
        ...currentPipeline,
        media_status: "media_missing",
        last_error: "media_locator_unresolved",
        media_checked_at: now,
        attempts: {
          ...currentAttempts,
          media: Number.isFinite(currentMediaAttempts) ? currentMediaAttempts + 1 : 1,
        },
      },
    },
  };
}

function mediaLocator(video: Record<string, unknown> | null | undefined): string {
  if (!video) return "";
  const candidates = [video.video_url, video.media_url, video.image_url, video.thumbnail];
  for (const item of candidates) {
    if (typeof item === "string" && isPlayableMediaLocator(item)) return item.trim();
  }
  return "";
}

function mediaLocatorCandidates(row: CorpusRow): string[] {
  const analyzedFull = rec(row.analyzed_full);
  const reelsSeed = rec(analyzedFull.reels_seed);
  return Array.isArray(reelsSeed.media_locator_candidates)
    ? reelsSeed.media_locator_candidates.filter((item) => typeof item === "string" && item.trim()) as string[]
    : [];
}

function mediaFocusNeedsDirectEvidence(fieldFocus: string, familyFocus: string) {
  return ["visual", "timeline", "hook", "mechanic", "guardrails", "positioning"].includes(familyFocus)
    || fieldFocus.includes("visual")
    || fieldFocus.includes("timeline")
    || fieldFocus.includes("second-by-second")
    || fieldFocus.includes("hook")
    || fieldFocus.includes("copy")
    || fieldFocus.includes("guardrail");
}

function mediaFocusBonus(input: {
  fieldFocus: string;
  familyFocus: string;
  row: CorpusRow;
}) {
  if (!mediaFocusNeedsDirectEvidence(input.fieldFocus, input.familyFocus)) return 0;
  const candidates = mediaLocatorCandidates(input.row);
  const hasDirect = candidates.some((item) => isDirectVideoLocator(item));
  const hasPlayable = candidates.some((item) => isPlayableMediaLocator(item));
  if (hasDirect) return 18;
  if (hasPlayable) return 10;
  if (/instagram\.com\/(reel|reels|tv|p)\//i.test(String(input.row.url || ""))) return 6;
  return 0;
}

function numberParam(req: NextRequest, name: string, fallback: number, min: number, max: number): number {
  const value = Number(req.nextUrl.searchParams.get(name) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function sameFocusSegment(row: CorpusRow, focusNiche: string, focusPlatform: string) {
  if (!focusNiche || !focusPlatform) return false;
  return String(row.niche || "").trim().toLowerCase() === focusNiche
    && String(row.platform || "").trim().toLowerCase() === focusPlatform;
}

function hasConfiguredYtDlpCookies(): boolean {
  if (String(process.env.YT_DLP_COOKIES_PATH || "").trim()) return true;
  if (String(process.env.YT_DLP_COOKIES_TXT || "").trim()) return true;
  if (String(process.env.YT_DLP_COOKIES_B64 || process.env.YT_DLP_COOKIES_BASE64 || "").trim()) return true;
  if (String(process.env.YT_DLP_COOKIES_GZ_B64 || "").trim()) return true;
  return Object.entries(process.env).some(([key, value]) =>
    /^YT_DLP_COOKIES_(B64|GZ_B64)_PART_\d+$/i.test(key) && typeof value === "string" && value.trim(),
  );
}

function localResolverAllowedForPlatform(platform: string): boolean {
  if (platform === "youtube") {
    return String(process.env.REELS_BRAIN_ENABLE_YOUTUBE_LOCAL_RESOLVER || "").toLowerCase() === "1"
      || hasConfiguredYtDlpCookies();
  }
  return true;
}

function widenedScanWindow(scan: number, shardCount: number, hardCap: number) {
  const multiplier = Math.max(4, shardCount * 4);
  return Math.max(scan, Math.min(hardCap, scan * multiplier));
}

function providerParam(req: NextRequest, platform: string): ReelsBrainProvider {
  const fallbackByPlatform: Record<string, string> = {
    instagram: process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_INSTAGRAM || process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER || "apify_instagram",
    tiktok: process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_TIKTOK || "apify_tiktok",
    youtube: process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_YOUTUBE || "youtube",
  };
  const raw = String(req.nextUrl.searchParams.get("provider") || fallbackByPlatform[platform] || "apify_instagram").trim().toLowerCase();
  return raw as ReelsBrainProvider;
}

function sameCanonical(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false;
  return canonicalizeReelsUrl(a).canonicalUrl === canonicalizeReelsUrl(b).canonicalUrl;
}

function effectiveProviderForQuery(provider: ReelsBrainProvider, query: string): ReelsBrainProvider {
  if (
    /instagram\.com\/p\//i.test(query)
    && provider === "bright_instagram"
    && hasReelsBrainProvider("bright_instagram_post")
  ) {
    return "bright_instagram_post";
  }
  return provider;
}

function syntheticDirectInput(query: string, platform: string): ReelsBrainInput[] {
  const target = String(query || "").trim();
  if (!/^https?:\/\//i.test(target)) return [];
  if (platform === "instagram" && /instagram\.com\//i.test(target)) return [{ url: target, platform: "instagram" }];
  if (platform === "youtube" && /(youtube\.com\/shorts\/|youtu\.be\/)/i.test(target)) return [{ url: target, platform: "youtube" }];
  if (platform === "tiktok" && /tiktok\.com\//i.test(target)) return [{ url: target, platform: "tiktok" }];
  return [];
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

    const platform = String(req.nextUrl.searchParams.get("platform") || "instagram").trim().toLowerCase();
    const provider = providerParam(req, platform);
    if (!hasReelsBrainProvider(provider)) {
      return NextResponse.json({ error: `${provider} не настроен` }, { status: 503 });
    }

    const niches = splitList(req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    const limit = numberParam(req, "limit", 3, 1, 6);
    const scan = numberParam(req, "scan", 120, limit, 500);
    const allowLocalResolverRequested = String(req.nextUrl.searchParams.get("use_local_resolver") || process.env.REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER || "").toLowerCase() === "1";
    const allowLocalResolver = allowLocalResolverRequested && localResolverAllowedForPlatform(platform);
    const ytDlpAvailable = allowLocalResolver ? await hasYtDlpBinary() : false;
    const deferTerminalMark = allowLocalResolverRequested && !ytDlpAvailable;
    const priorityMode = String(req.nextUrl.searchParams.get("priority") || "smart").trim().toLowerCase();
    const focusNiche = String(req.nextUrl.searchParams.get("focus_niche") || "").trim().toLowerCase();
    const focusPlatform = String(req.nextUrl.searchParams.get("focus_platform") || "").trim().toLowerCase();
    const sourceDiscoveryMode = String(req.nextUrl.searchParams.get("source_discovery_mode") || "").trim().toLowerCase();
    const fieldFocus = String(req.nextUrl.searchParams.get("field_focus") || "").trim().toLowerCase();
    const familyFocus = String(req.nextUrl.searchParams.get("family_focus") || "").trim().toLowerCase();
    const { shardIndex, shardCount } = parseShardConfig({
      shardIndex: req.nextUrl.searchParams.get("shard_index"),
      shardCount: req.nextUrl.searchParams.get("shard_count"),
    });

    const queryScan = widenedScanWindow(scan, shardCount, 800);
    const { data, error } = await db
      .from("viral_videos")
      .select("id,niche,platform,url,analyzed_full,created_at,virality_score,views")
      .in("niche", niches)
      .eq("platform", platform)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(queryScan);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const corpusRows = ((data || []) as CorpusRow[])
      .filter((row) => stableShardMatch(row.id, shardIndex, shardCount))
      .filter((row) => row.url && !hasResolvedMediaLocators(row) && !hasTerminalMediaFailure(row))
      .map((row) => {
        const focusMatch = sameFocusSegment(row, focusNiche, focusPlatform);
        const baseScore = priorityMode === "fifo"
          ? 0
          : scoreMediaCandidate({
            id: row.id,
            viralityScore: row.virality_score,
            views: row.views,
            createdAt: row.created_at,
            hasPageFallback: /instagram\.com\/(reel|reels|tv|p)\//i.test(String(row.url || "")),
          });
        const focusBoost = focusMatch
          ? sourceDiscoveryMode === "close_exact_proof" || sourceDiscoveryMode === "pin_winner_provider"
            ? 28
            : sourceDiscoveryMode === "seed_and_collect"
              ? 22
              : 16
          : 0;
        const fieldBoost = focusMatch ? mediaFocusBonus({ fieldFocus, familyFocus, row }) : 0;
        return {
          row,
          focusMatch,
          priority: Math.round((baseScore + focusBoost + fieldBoost) * 10) / 10,
        };
      })
      .sort((a, b) =>
        Number(b.focusMatch) - Number(a.focusMatch)
        || b.priority - a.priority
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
      const syntheticFallback = syntheticDirectInput(query, platform);
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

      if (!matched.length && syntheticFallback.length) {
        matched.push(...syntheticFallback);
      }

      if (mediaReady.length) withMedia += 1;
      if (!mediaReady.length && !resolverSample && !deferTerminalMark) {
        await db
          .from("viral_videos")
          .update({
            analyzed_full: markMediaLocatorUnresolved(row.analyzed_full),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }

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
      deferred_terminal_mark: deferTerminalMark,
      shard_index: shardIndex,
      shard_count: shardCount,
      priority: priorityMode,
      focus_niche: focusNiche || null,
      focus_platform: focusPlatform || null,
      source_discovery_mode: sourceDiscoveryMode || null,
      field_focus: fieldFocus || null,
      family_focus: familyFocus || null,
      scanned: queryScan,
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
