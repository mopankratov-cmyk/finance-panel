import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { transcribeFal } from "./asr";

const execFileAsync = promisify(execFile);

export type ReelsBrainResolvedMedia = {
  media_url: string | null;
  title: string | null;
  author: string | null;
  duration_sec: number | null;
  extractor: string | null;
  source: "yt_dlp";
};

export type ReelsBrainAudioFeatures = {
  media_url: string;
  stream_access: "remote_stream";
  extractor: "ffprobe+ffmpeg";
  has_audio_stream: boolean;
  media_duration_sec: number | null;
  audio_duration_sec: number | null;
  sample_rate_hz: number | null;
  channels: number | null;
  bit_rate_kbps: number | null;
  mean_volume_db: number | null;
  max_volume_db: number | null;
  first_sound_sec: number | null;
  first_speech_event_sec: number | null;
  silence_segments: Array<{ start_sec: number | null; end_sec: number | null; duration_sec: number | null }>;
  pause_count: number;
  long_pause_count: number;
  dead_air_ratio_pct: number | null;
  pacing_tier: "fast" | "medium" | "slow" | "unknown";
  beat_density_hint: "high" | "medium" | "low" | "unknown";
  transcript_source: "fal_whisper" | null;
  transcript_error: string | null;
  words_per_second: number | null;
  extracted_at: string;
};

export type ReelsBrainAudioExtractionResult = {
  ok: boolean;
  media_status: "media_downloaded" | "audio_failed";
  audio_status: "audio_extracted" | "audio_failed";
  transcript_status: "transcript_ready" | "transcript_failed" | "transcript_pending";
  audio_features: ReelsBrainAudioFeatures | null;
  transcript: string | null;
  error: string | null;
};

export function isTerminalTranscriptError(error: unknown): boolean {
  const value = text(error, 240)?.toLowerCase() || "";
  if (!value) return false;
  return value.includes("whisper_empty_text") || value.includes("transcript_no_speech");
}

export function isTerminalAudioError(error: unknown): boolean {
  const value = text(error, 240)?.toLowerCase() || "";
  if (!value) return false;
  return value.includes("media_fetch_403")
    || value.includes("status code 10204")
    || value.includes("video not available")
    || value.includes("image_media_locator")
    || value.includes("media_locator_unresolved")
    || value.includes("moov atom not found")
    || value.includes("invalid data found when processing input")
    || value.includes("audio_stream_missing")
    || value.includes("audio_stream_not_found");
}

export function shouldRetryTranscriptExtraction(state: {
  audioStatus?: string | null;
  transcriptStatus?: string | null;
  transcriptError?: unknown;
}): boolean {
  const audioStatus = text(state.audioStatus, 60) || "audio_pending";
  const transcriptStatus = text(state.transcriptStatus, 60) || "transcript_pending";
  if (audioStatus !== "audio_extracted") return true;
  if (transcriptStatus === "transcript_ready") return false;
  return !isTerminalTranscriptError(state.transcriptError);
}

export function shouldRetryAudioBackfill(state: {
  audioStatus?: string | null;
  transcriptStatus?: string | null;
  transcriptError?: unknown;
  lastError?: unknown;
}): boolean {
  const audioStatus = text(state.audioStatus, 60) || "audio_pending";
  if (audioStatus !== "audio_extracted") {
    return !isTerminalAudioError(state.lastError);
  }
  return shouldRetryTranscriptExtraction(state);
}

function text(value: unknown, max = 1200): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out ? out.slice(0, max) : null;
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickFormatUrl(payload: Record<string, unknown>): string | null {
  const direct = text(payload.url);
  if (direct && /^https?:\/\//i.test(direct)) return direct;

  const requested = Array.isArray(payload.requested_formats) ? payload.requested_formats : [];
  for (const format of requested) {
    const url = text(rec(format).url);
    if (url && /^https?:\/\//i.test(url)) return url;
  }

  const formats = Array.isArray(payload.formats) ? payload.formats : [];
  for (const format of [...formats].reverse()) {
    const row = rec(format);
    const url = text(row.url);
    const ext = text(row.ext, 20);
    const vcodec = text(row.vcodec, 40);
    if (url && /^https?:\/\//i.test(url) && (ext === "mp4" || vcodec && vcodec !== "none")) return url;
  }

  return null;
}

function normalizeYtDlpTarget(url: string): string {
  const target = text(url, 1500);
  if (!target) return "";
  try {
    const parsed = new URL(target);
    if (/tiktok\.com$/i.test(parsed.hostname) && /\/v\/[^/]+\.html$/i.test(parsed.pathname)) {
      const shareItemId = text(parsed.searchParams.get("share_item_id"), 120);
      if (shareItemId && /^\d{8,24}$/.test(shareItemId)) {
        return `https://www.tiktok.com/embed/v2/${shareItemId}`;
      }
    }
    return parsed.toString();
  } catch {
    return target;
  }
}

function shouldUseCookies(target: string): boolean {
  if (/(^https?:\/\/)?([a-z0-9-]+\.)?(youtube\.com|youtu\.be)(\/|$)/i.test(target)) {
    return false;
  }
  return false;
}

function shouldSkipDownloadForProbe(target: string): boolean {
  return !shouldUseCookies(target);
}

export async function hasYtDlpBinary(): Promise<boolean> {
  try {
    await execFileAsync("yt-dlp", ["--version"], { timeout: 5000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function hasBinary(binary: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(binary, args, { timeout: 5000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

export async function hasFfmpegBinary(): Promise<boolean> {
  return hasBinary("ffmpeg", ["-version"]);
}

export async function hasFfprobeBinary(): Promise<boolean> {
  return hasBinary("ffprobe", ["-version"]);
}

export async function resolveMediaLocatorViaYtDlp(url: string): Promise<ReelsBrainResolvedMedia | null> {
  const target = normalizeYtDlpTarget(url);
  if (!target) return null;
  try {
    const probeArgs = ["-J", "--no-warnings"];
    if (shouldSkipDownloadForProbe(target)) probeArgs.push("--skip-download");
    probeArgs.push(target);
    const { stdout } = await execFileAsync(
      "yt-dlp",
      probeArgs,
      { timeout: 45000, maxBuffer: 8 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    const mediaUrl = pickFormatUrl(payload);
    return {
      media_url: mediaUrl,
      title: text(payload.title, 500),
      author: text(payload.uploader, 240) || text(payload.channel, 240),
      duration_sec: num(payload.duration),
      extractor: text(payload.extractor_key, 120) || text(payload.extractor, 120),
      source: "yt_dlp",
    };
  } catch {
    return null;
  }
}

type ProbePayload = {
  format?: {
    duration?: string;
    bit_rate?: string;
  };
  streams?: Array<{
    codec_type?: string;
    duration?: string;
    sample_rate?: string;
    channels?: number;
    bit_rate?: string;
  }>;
};

async function probeMediaAudio(url: string): Promise<ProbePayload | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-show_format",
        "-show_streams",
        "-of", "json",
        url,
      ],
      { timeout: 45000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as ProbePayload;
  } catch {
    return null;
  }
}

function parseSilenceSegments(stderr: string) {
  const starts = Array.from(stderr.matchAll(/silence_start:\s*([0-9.]+)/g)).map((match) => parseNumber(match[1]));
  const ends = Array.from(stderr.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g))
    .map((match) => ({
      end_sec: parseNumber(match[1]),
      duration_sec: parseNumber(match[2]),
    }));

  const segments: Array<{ start_sec: number | null; end_sec: number | null; duration_sec: number | null }> = [];
  const total = Math.max(starts.length, ends.length);
  for (let index = 0; index < total; index += 1) {
    segments.push({
      start_sec: starts[index] ?? null,
      end_sec: ends[index]?.end_sec ?? null,
      duration_sec: ends[index]?.duration_sec ?? null,
    });
  }
  return segments.slice(0, 12);
}

async function inspectAudioLevels(url: string) {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      [
        "-v", "info",
        "-i", url,
        "-vn",
        "-af", "volumedetect,silencedetect=n=-35dB:d=0.20",
        "-f", "null",
        "-",
      ],
      { timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
    );
    const meanVolume = stderr.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/i)?.[1];
    const maxVolume = stderr.match(/max_volume:\s*(-?[0-9.]+)\s*dB/i)?.[1];
    const silenceSegments = parseSilenceSegments(stderr);
    let firstSoundSec = 0;
    if (silenceSegments.length && silenceSegments[0]?.start_sec === 0 && silenceSegments[0]?.end_sec != null) {
      firstSoundSec = silenceSegments[0].end_sec || 0;
    }
    return {
      mean_volume_db: parseNumber(meanVolume),
      max_volume_db: parseNumber(maxVolume),
      first_sound_sec: firstSoundSec,
      silence_segments: silenceSegments,
    };
  } catch {
    return {
      mean_volume_db: null,
      max_volume_db: null,
      first_sound_sec: null,
      silence_segments: [] as Array<{ start_sec: number | null; end_sec: number | null; duration_sec: number | null }>,
    };
  }
}

export async function extractAudioFeaturesFromMediaUrl(
  mediaUrl: string,
  options: { transcribe?: boolean; language?: string } = {},
): Promise<ReelsBrainAudioExtractionResult> {
  const target = text(mediaUrl, 1500);
  if (!target) {
    return {
      ok: false,
      media_status: "audio_failed",
      audio_status: "audio_failed",
      transcript_status: "transcript_pending",
      audio_features: null,
      transcript: null,
      error: "missing_media_url",
    };
  }

  let transcript: string | null = null;
  let transcriptError: string | null = null;
  let transcriptStatus: ReelsBrainAudioExtractionResult["transcript_status"] = "transcript_pending";

  if (options.transcribe) {
    const transcribed = await transcribeFal(target, options.language || "ru");
    transcript = transcribed.text;
    transcriptError = transcribed.error || null;
    transcriptStatus = transcript ? "transcript_ready" : (transcriptError ? "transcript_failed" : "transcript_pending");
  }

  const [ffprobeReady, ffmpegReady] = await Promise.all([hasFfprobeBinary(), hasFfmpegBinary()]);
  if (!ffprobeReady || !ffmpegReady) {
    return {
      ok: Boolean(transcript),
      media_status: "audio_failed",
      audio_status: "audio_failed",
      transcript_status: transcriptStatus,
      audio_features: null,
      transcript,
      error: [
        !ffprobeReady ? "ffprobe_unavailable" : null,
        !ffmpegReady ? "ffmpeg_unavailable" : null,
        transcriptError,
      ].filter(Boolean).join("; ") || null,
    };
  }

  const probe = await probeMediaAudio(target);
  const audioStream = (probe?.streams || []).find((stream) => stream.codec_type === "audio");
  if (!probe || !audioStream) {
    return {
      ok: false,
      media_status: "audio_failed",
      audio_status: "audio_failed",
      transcript_status: "transcript_pending",
      audio_features: null,
      transcript: null,
      error: "audio_stream_not_found",
    };
  }

  const levels = await inspectAudioLevels(target);
  const mediaDuration = parseNumber(probe.format?.duration);
  const audioDuration = parseNumber(audioStream.duration) ?? mediaDuration;
  const transcriptWords = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  const wordsPerSecond = transcriptWords > 0 && audioDuration && audioDuration > 0
    ? Math.round((transcriptWords / audioDuration) * 1000) / 1000
    : null;
  const pauseCount = levels.silence_segments.filter((segment) => (segment.duration_sec || 0) >= 0.2).length;
  const longPauseCount = levels.silence_segments.filter((segment) => (segment.duration_sec || 0) >= 0.8).length;
  const deadAirSeconds = levels.silence_segments.reduce((sum, segment) => sum + (segment.duration_sec || 0), 0);
  const deadAirRatioPct = audioDuration && audioDuration > 0
    ? Math.round((deadAirSeconds / audioDuration) * 1000) / 10
    : null;
  const pacingTier = wordsPerSecond == null
    ? "unknown"
    : wordsPerSecond >= 3.4
      ? "fast"
      : wordsPerSecond >= 2
        ? "medium"
        : "slow";
  const beatDensityHint = pauseCount >= 10
    ? "high"
    : pauseCount >= 5
      ? "medium"
      : pauseCount > 0
        ? "low"
        : "unknown";

  const audioFeatures: ReelsBrainAudioFeatures = {
    media_url: target,
    stream_access: "remote_stream",
    extractor: "ffprobe+ffmpeg",
    has_audio_stream: true,
    media_duration_sec: mediaDuration,
    audio_duration_sec: audioDuration,
    sample_rate_hz: parseNumber(audioStream.sample_rate),
    channels: typeof audioStream.channels === "number" ? audioStream.channels : null,
    bit_rate_kbps: (() => {
      const streamBitRate = parseNumber(audioStream.bit_rate);
      const formatBitRate = parseNumber(probe.format?.bit_rate);
      const bitRate = streamBitRate ?? formatBitRate;
      return bitRate != null ? Math.round(bitRate / 1000) : null;
    })(),
    mean_volume_db: levels.mean_volume_db,
    max_volume_db: levels.max_volume_db,
    first_sound_sec: levels.first_sound_sec,
    first_speech_event_sec: transcript ? (levels.first_sound_sec ?? 0) : null,
    silence_segments: levels.silence_segments,
    pause_count: pauseCount,
    long_pause_count: longPauseCount,
    dead_air_ratio_pct: deadAirRatioPct,
    pacing_tier: pacingTier,
    beat_density_hint: beatDensityHint,
    transcript_source: transcript ? "fal_whisper" : null,
    transcript_error: transcriptError,
    words_per_second: wordsPerSecond,
    extracted_at: new Date().toISOString(),
  };

  return {
    ok: true,
    media_status: "media_downloaded",
    audio_status: "audio_extracted",
    transcript_status: transcriptStatus,
    audio_features: audioFeatures,
    transcript,
    error: transcriptError,
  };
}
