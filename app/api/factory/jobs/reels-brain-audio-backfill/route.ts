import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { extractAudioFeaturesFromMediaUrl, shouldRetryAudioBackfill } from "@/lib/factory/reelsBrainMediaResolver";
import { mergeAnalyzedFullWithAudioExtraction } from "@/lib/factory/reelsBrainCorpusUpsert";
import { parseShardConfig, scoreAudioCandidate, stableShardMatch } from "@/lib/factory/reelsBrainQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type CorpusRow = {
  id: number;
  niche?: string | null;
  platform?: string | null;
  url?: string | null;
  analyzed?: boolean | null;
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

function text(value: unknown, max = 1200): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function numberParam(req: NextRequest, name: string, fallback: number, min: number, max: number): number {
  const value = Number(req.nextUrl.searchParams.get(name) || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function widenedScanWindow(scan: number, shardCount: number, hardCap: number) {
  const multiplier = Math.max(4, shardCount * 4);
  return Math.max(scan, Math.min(hardCap, scan * multiplier));
}

async function fetchCorpusRows(input: {
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>;
  niches: string[];
  platform: string;
  queryScan: number;
}) {
  const pageSize = 1000;
  const rows: CorpusRow[] = [];

  for (let offset = 0; offset < input.queryScan; offset += pageSize) {
    const upper = Math.min(offset + pageSize - 1, input.queryScan - 1);
    let query = input.db
      .from("viral_videos")
      .select("id,niche,platform,url,analyzed,analyzed_full,created_at,virality_score,views")
      .in("niche", input.niches)
      .order("created_at", { ascending: false, nullsFirst: false })
      .range(offset, upper);

    if (input.platform) query = query.eq("platform", input.platform);

    const { data, error } = await query;
    if (error) return { data: null, error };

    const batch = (data || []) as CorpusRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return { data: rows, error: null };
}

function boolParam(req: NextRequest, name: string, fallback = false): boolean {
  const value = String(req.nextUrl.searchParams.get(name) || "").trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

function sameFocusSegment(row: CorpusRow, focusNiche: string, focusPlatform: string) {
  if (!focusNiche || !focusPlatform) return false;
  return String(row.niche || "").trim().toLowerCase() === focusNiche
    && String(row.platform || "").trim().toLowerCase() === focusPlatform;
}

function seedState(row: CorpusRow) {
  const analyzedFull = rec(row.analyzed_full);
  const reelsSeed = rec(analyzedFull.reels_seed);
  const pipeline = rec(reelsSeed.pipeline);
  const mediaLocators = Array.isArray(reelsSeed.media_locator_candidates)
    ? reelsSeed.media_locator_candidates.filter((item) => typeof item === "string" && item.trim())
    : [];
  return {
    mediaLocators,
    transcript: text(reelsSeed.transcript, 6000) || "",
    audioFeatures: rec(reelsSeed.audio_features),
    audioStatus: text(pipeline.audio_status, 60) || "audio_pending",
    transcriptStatus: text(pipeline.transcript_status, 60) || "transcript_pending",
    lastError: text(pipeline.last_error, 240),
  };
}

function isImageLikeLocator(value: string): boolean {
  const target = value.trim().toLowerCase();
  if (!target) return false;
  return /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|avif)(\?|$)/i.test(target);
}

function isDirectVideoLocator(value: string): boolean {
  const target = value.trim();
  if (!target) return false;
  if (isImageLikeLocator(target)) return false;
  if (/\.(mp4|m4v|mov|webm|m3u8)(\?|$)/i.test(target)) return true;
  if (/mime_type=video_|video_mp4|\/video\/|\/videoplayback\b|\.googlevideo\.com\//i.test(target)) return true;
  return false;
}

function isPlayableMediaLocator(value: string, platform = ""): boolean {
  const target = value.trim();
  if (!target) return false;
  if (isImageLikeLocator(target)) return false;
  if (isDirectVideoLocator(target)) return true;
  if (!/^https?:\/\//i.test(target)) return false;
  if (platform === "youtube" && /(youtube\.com\/shorts\/|youtube\.com\/watch\?|youtu\.be\/)/i.test(target)) return true;
  if (platform === "instagram" && /(instagram\.com|instagr\.am)\/(reel|reels|tv|p)\//i.test(target)) return true;
  if (platform === "tiktok") return false;
  return true;
}

function bestMediaLocator(row: CorpusRow): string {
  const state = seedState(row);
  const direct = state.mediaLocators.find((item) => isDirectVideoLocator(item));
  if (direct) return direct;
  const platform = String(row.platform || "").trim().toLowerCase();
  return state.mediaLocators.find((item) => isPlayableMediaLocator(item, platform)) || "";
}

function hasRecoverablePageFallback(state: ReturnType<typeof seedState>, platform: string): boolean {
  if (!state.mediaLocators.length) return false;
  return state.mediaLocators.some((item) => isPlayableMediaLocator(item, platform) && !isDirectVideoLocator(item));
}

function audioFocusNeedsTranscript(fieldFocus: string, familyFocus: string) {
  return ["audio", "retention", "hook", "structure"].includes(familyFocus)
    || fieldFocus.includes("audio")
    || fieldFocus.includes("retention")
    || fieldFocus.includes("transcript")
    || fieldFocus.includes("speech")
    || fieldFocus.includes("hook")
    || fieldFocus.includes("structure");
}

function audioFocusNeedsExtraction(fieldFocus: string, familyFocus: string) {
  return ["audio", "retention"].includes(familyFocus)
    || fieldFocus.includes("audio")
    || fieldFocus.includes("retention")
    || fieldFocus.includes("speech");
}

function audioFocusBonus(input: {
  fieldFocus: string;
  familyFocus: string;
  state: ReturnType<typeof seedState>;
  mediaUrl: string;
}) {
  const wantsTranscript = audioFocusNeedsTranscript(input.fieldFocus, input.familyFocus);
  const wantsExtraction = audioFocusNeedsExtraction(input.fieldFocus, input.familyFocus);
  const hasDirectMedia = Boolean(input.mediaUrl && isDirectVideoLocator(input.mediaUrl));
  let boost = 0;
  if (wantsExtraction && input.state.audioStatus !== "audio_extracted") {
    boost += hasDirectMedia ? 18 : 10;
  }
  if (wantsTranscript && input.state.transcriptStatus !== "transcript_ready") {
    boost += input.state.audioStatus === "audio_extracted" ? 20 : 12;
  }
  return boost;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

    const niches = splitList(req.nextUrl.searchParams.get("niches") || "ru_toys,ru_clothing,ru_cosmetics");
    const limit = numberParam(req, "limit", 2, 1, 6);
    const scan = numberParam(req, "scan", 24, limit, 2000);
    const platform = String(req.nextUrl.searchParams.get("platform") || "").trim().toLowerCase();
    const transcribe = boolParam(req, "transcribe", true);
    const dryRun = boolParam(req, "dry_run", false);
    const language = String(req.nextUrl.searchParams.get("language") || "ru").trim().slice(0, 12) || "ru";
    const priorityMode = String(req.nextUrl.searchParams.get("priority") || "smart").trim().toLowerCase();
    const deepOnly = boolParam(req, "deep_only", false);
    const focusNiche = String(req.nextUrl.searchParams.get("focus_niche") || "").trim().toLowerCase();
    const focusPlatform = String(req.nextUrl.searchParams.get("focus_platform") || "").trim().toLowerCase();
    const sourceDiscoveryMode = String(req.nextUrl.searchParams.get("source_discovery_mode") || "").trim().toLowerCase();
    const fieldFocus = String(req.nextUrl.searchParams.get("field_focus") || "").trim().toLowerCase();
    const familyFocus = String(req.nextUrl.searchParams.get("family_focus") || "").trim().toLowerCase();
    const { shardIndex, shardCount } = parseShardConfig({
      shardIndex: req.nextUrl.searchParams.get("shard_index"),
      shardCount: req.nextUrl.searchParams.get("shard_count"),
    });

    const queryScan = widenedScanWindow(scan, shardCount, 5000);
    const { data, error } = await fetchCorpusRows({
      db,
      niches,
      platform,
      queryScan,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ranked = ((data || []) as CorpusRow[])
      .filter((row) => stableShardMatch(row.id, shardIndex, shardCount))
      .filter((row) => {
        const state = seedState(row);
        const platform = String(row.platform || "").trim().toLowerCase();
        const hasPlayable = state.mediaLocators.some((item) => isPlayableMediaLocator(item, platform));
        if (!hasPlayable) return false;
        const shouldRetry = shouldRetryAudioBackfill({
          audioStatus: state.audioStatus,
          transcriptStatus: state.transcriptStatus,
          transcriptError: state.audioFeatures?.transcript_error,
          lastError: state.lastError,
        });
        const retryRecoverableFallback = (
          state.audioStatus !== "audio_extracted"
          && hasRecoverablePageFallback(state, platform)
          && Boolean(state.lastError)
        );
        return (shouldRetry || retryRecoverableFallback)
          && (!state.audioStatus || state.audioStatus !== "audio_extracted" || transcribe);
      })
      .map((row) => {
        const state = seedState(row);
        const platform = String(row.platform || "").trim().toLowerCase();
        const mediaUrl = bestMediaLocator(row);
        const focusMatch = sameFocusSegment(row, focusNiche, focusPlatform);
        const baseScore = priorityMode === "fifo"
          ? 0
          : scoreAudioCandidate({
            id: row.id,
            viralityScore: row.virality_score,
            views: row.views,
            createdAt: row.created_at,
            audioStatus: state.audioStatus,
            transcriptStatus: state.transcriptStatus,
            hasDirectMedia: Boolean(mediaUrl && isDirectVideoLocator(mediaUrl)),
            hasPageFallback: Boolean(platform === "instagram" && /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|tv|p)\//i.test(mediaUrl)),
          });
        const focusBoost = focusMatch
          ? sourceDiscoveryMode === "close_exact_proof" || sourceDiscoveryMode === "pin_winner_provider"
            ? state.audioStatus === "audio_extracted" && state.transcriptStatus !== "transcript_ready"
              ? 42
              : 30
            : sourceDiscoveryMode === "seed_and_collect"
              ? 24
              : 18
          : 0;
        const fieldBoost = focusMatch ? audioFocusBonus({ fieldFocus, familyFocus, state, mediaUrl }) : 0;
        return {
          row,
          state,
          mediaUrl,
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
      );

    const exactFocusRanked = focusNiche && focusPlatform
      ? ranked.filter((entry) => entry.focusMatch)
      : [];
    const deepRanked = ranked.filter((entry) => Number(entry.row.virality_score || 0) >= 45);
    const deepFocusedRanked = deepRanked.filter((entry) => entry.focusMatch);
    const fieldFocusedDeepOnly = audioFocusNeedsExtraction(fieldFocus, familyFocus) || audioFocusNeedsTranscript(fieldFocus, familyFocus);
    const selectedRanked = deepOnly || fieldFocusedDeepOnly
      ? deepFocusedRanked.length
        ? deepFocusedRanked
        : deepRanked.length
          ? deepRanked
          : exactFocusRanked.length
            ? exactFocusRanked
            : ranked
      : exactFocusRanked.length
        ? [...exactFocusRanked, ...ranked.filter((entry) => !entry.focusMatch)]
        : ranked;
    const deepOnlyRelaxed = Boolean(deepOnly && !deepFocusedRanked.length && !deepRanked.length && ranked.length);

    const rows = selectedRanked
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
    let extracted = 0;
    let transcriptReady = 0;
    let failed = 0;

    for (const row of rows) {
      const mediaUrl = bestMediaLocator(row);
      if (!mediaUrl) continue;

      if (dryRun) {
        const state = seedState(row);
        runs.push({
          id: row.id,
          niche: row.niche,
          platform: row.platform,
          url: row.url,
          media_url: mediaUrl,
          ok: true,
          audio_status: state.audioStatus,
          transcript_status: state.transcriptStatus,
          dry_run: true,
        });
        continue;
      }

      const result = await extractAudioFeaturesFromMediaUrl(mediaUrl, { transcribe, language });
      const merged = mergeAnalyzedFullWithAudioExtraction(row.analyzed_full, {
        mediaUrl,
        mediaStatus: result.media_status,
        audioStatus: result.audio_status,
        transcriptStatus: result.transcript_status,
        transcript: result.transcript,
        audioFeatures: result.audio_features as Record<string, unknown> | null,
        error: result.error,
      });

      const { error: updateError } = await db
        .from("viral_videos")
        .update({
          analyzed_full: merged,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (updateError) {
        failed += 1;
        runs.push({
          id: row.id,
          niche: row.niche,
          platform: row.platform,
          url: row.url,
          media_url: mediaUrl,
          ok: false,
          error: updateError.message,
        });
        continue;
      }

      if (result.audio_status === "audio_extracted") extracted += 1;
      if (result.transcript_status === "transcript_ready") transcriptReady += 1;
      if (!result.ok) failed += 1;

      runs.push({
        id: row.id,
        niche: row.niche,
        platform: row.platform,
        url: row.url,
        media_url: mediaUrl,
        ok: result.ok,
        media_status: result.media_status,
        audio_status: result.audio_status,
        transcript_status: result.transcript_status,
        transcript_words: result.transcript ? result.transcript.split(/\s+/).filter(Boolean).length : 0,
        sample_rate_hz: result.audio_features?.sample_rate_hz || null,
        channels: result.audio_features?.channels || null,
        mean_volume_db: result.audio_features?.mean_volume_db || null,
        first_sound_sec: result.audio_features?.first_sound_sec || null,
        error: result.error,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: dryRun ? "reels_brain_audio_backfill_dry_run" : "reels_brain_audio_backfill",
      platform: platform || "mixed",
      dry_run: dryRun,
      shard_index: shardIndex,
      shard_count: shardCount,
      priority: priorityMode,
      deep_only: deepOnly,
      field_focused_deep_only: fieldFocusedDeepOnly,
      deep_only_relaxed: deepOnlyRelaxed,
      focus_niche: focusNiche || null,
      focus_platform: focusPlatform || null,
      source_discovery_mode: sourceDiscoveryMode || null,
      field_focus: fieldFocus || null,
      family_focus: familyFocus || null,
      scanned: queryScan,
      attempted: rows.length,
      extracted,
      transcript_ready: transcriptReady,
      failed,
      runs,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: "reels-brain-audio-backfill crash: " + String((error as Error)?.message || error).slice(0, 180),
    }, { status: 500 });
  }
}
