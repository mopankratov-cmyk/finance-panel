import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { extractAudioFeaturesFromMediaUrl } from "@/lib/factory/reelsBrainMediaResolver";
import { mergeAnalyzedFullWithAudioExtraction } from "@/lib/factory/reelsBrainCorpusUpsert";

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

function boolParam(req: NextRequest, name: string, fallback = false): boolean {
  const value = String(req.nextUrl.searchParams.get(name) || "").trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes";
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
  return /^https?:\/\//i.test(target);
}

function bestMediaLocator(row: CorpusRow): string {
  const state = seedState(row);
  const platform = String(row.platform || "").trim().toLowerCase();
  const direct = state.mediaLocators.find((item) => isDirectVideoLocator(item));
  if (direct) return direct;

  if (platform === "instagram") {
    const reelPage = state.mediaLocators.find((item) => /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|tv)\//i.test(item.trim()));
    return reelPage || "";
  }

  return state.mediaLocators.find((item) => isPlayableMediaLocator(item, platform)) || "";
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
    const scan = numberParam(req, "scan", 24, limit, 120);
    const platform = String(req.nextUrl.searchParams.get("platform") || "").trim().toLowerCase();
    const transcribe = boolParam(req, "transcribe", true);
    const dryRun = boolParam(req, "dry_run", false);
    const language = String(req.nextUrl.searchParams.get("language") || "ru").trim().slice(0, 12) || "ru";

    let query = db
      .from("viral_videos")
      .select("id,niche,platform,url,analyzed,analyzed_full,created_at")
      .in("niche", niches)
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(scan);

    if (platform) query = query.eq("platform", platform);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = ((data || []) as CorpusRow[])
      .filter((row) => {
        const state = seedState(row);
        const hasPlayable = state.mediaLocators.some((item) => isPlayableMediaLocator(item, String(row.platform || "")));
        if (!hasPlayable) return false;
        if (state.audioStatus !== "audio_extracted") return true;
        return transcribe && state.transcriptStatus !== "transcript_ready";
      })
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
