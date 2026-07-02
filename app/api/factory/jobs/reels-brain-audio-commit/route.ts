import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { mergeAnalyzedFullWithAudioExtraction } from "@/lib/factory/reelsBrainCorpusUpsert";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function text(value: unknown, max = 6000): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function allowedAudioStatus(value: unknown): "audio_extracted" | "audio_failed" {
  return String(value).trim() === "audio_extracted" ? "audio_extracted" : "audio_failed";
}

function allowedMediaStatus(value: unknown): "media_downloaded" | "audio_failed" {
  return String(value).trim() === "media_downloaded" ? "media_downloaded" : "audio_failed";
}

function allowedTranscriptStatus(value: unknown): "transcript_ready" | "transcript_failed" | "transcript_pending" {
  const target = String(value).trim();
  if (target === "transcript_ready" || target === "transcript_failed") return target;
  return "transcript_pending";
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isAuthorizedReelsBrainJobRequest(req))) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const id = Number(body.id || 0);
    const mediaUrl = text(body.media_url, 1500);
    if (!id || !mediaUrl) {
      return NextResponse.json({ error: "id и media_url обязательны" }, { status: 400 });
    }

    const { data, error } = await db
      .from("viral_videos")
      .select("id,analyzed_full")
      .eq("id", id)
      .limit(1)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "video_not_found" }, { status: 404 });

    const merged = mergeAnalyzedFullWithAudioExtraction(data.analyzed_full, {
      mediaUrl,
      mediaStatus: allowedMediaStatus(body.media_status),
      audioStatus: allowedAudioStatus(body.audio_status),
      transcriptStatus: allowedTranscriptStatus(body.transcript_status),
      transcript: text(body.transcript, 6000),
      audioFeatures: rec(body.audio_features),
      error: text(body.error, 240),
    });

    const { error: updateError } = await db
      .from("viral_videos")
      .update({
        analyzed_full: merged,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      id,
      media_url: mediaUrl,
      audio_status: allowedAudioStatus(body.audio_status),
      transcript_status: allowedTranscriptStatus(body.transcript_status),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: "reels-brain-audio-commit crash: " + String((error as Error)?.message || error).slice(0, 180),
    }, { status: 500 });
  }
}
