#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const opts = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      opts[arg.slice(2)] = next;
      i += 1;
    } else {
      opts[arg.slice(2)] = true;
    }
  }
  return opts;
}

function usage() {
  console.log(`Usage:
  BASE_URL=https://finance-panel-two.vercel.app CRON_SECRET=... node lib/factory/reelsBrainOfflineWorker.mjs --once
  BASE_URL=https://finance-panel-two.vercel.app CRON_SECRET=... REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER=1 node lib/factory/reelsBrainOfflineWorker.mjs --every-sec=180

Options:
  --base <url>                 Override BASE_URL
  --secret <token>             Override CRON_SECRET
  --mode <media|audio|mixed>   Worker mode (default: media)
  --provider <name>            Provider for media backfill (default: apify_instagram)
  --platform <name>            Single platform to backfill (default: instagram)
  --platforms <csv>            Rotate backfill across these platforms (default: env REELS_BRAIN_PLATFORMS or platform)
  --niches <csv>               Niche list (default: ru_toys,ru_clothing,ru_cosmetics)
  --limit <n>                  Rows per cycle (default: 3)
  --scan <n>                   Scan window per cycle (default: 30)
  --transcribe <0|1>           Enable transcript step in audio mode (default: 1)
  --language <code>            Transcript language in audio mode (default: ru)
  --every-sec <n>              Loop interval in seconds
  --max-cycles <n>             Stop after N cycles
  --once                       Run one cycle and exit
  --use-local-resolver <0|1>   Force yt-dlp resolver flag in API call
  --local-audio <0|1>          Run audio extraction locally on worker (default: 1 when ffmpeg/ffprobe exist)
  --heartbeat <0|1>            Send worker-state heartbeats (default: 1)
  --worker-id <id>             Worker id (default: reels-brain-offline-worker)
  --label <text>               Worker label
  --task-id <id>               Worker task id
  --task-title <text>          Worker task title
  --help                       Show help
`);
}

function toText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boolFlag(value, fallback = false) {
  if (value == null) return fallback;
  if (value === true) return true;
  const text = String(value).trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function intFlag(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value, max = 1500) {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out ? out.slice(0, max) : null;
}

function isImageLikeUrl(value) {
  const target = String(value || "").trim().toLowerCase();
  if (!target) return false;
  return /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif|avif)(\?|$)/i.test(target);
}

async function isDirectMediaReachable(url) {
  const target = toText(url);
  if (!target || isImageLikeUrl(target)) return false;
  try {
    const response = await fetch(target, {
      method: "HEAD",
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = toText(response.headers.get("content-type"))?.toLowerCase() || "";
    if (!response.ok) return false;
    if (!contentType) return true;
    if (contentType.startsWith("video/") || contentType.startsWith("audio/")) return true;
    return !contentType.startsWith("text/html");
  } catch {
    return false;
  }
}

async function hasBinary(binary, args = ["--version"]) {
  try {
    await execFileAsync(binary, args, { timeout: 5000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

function falConfigured() {
  return Boolean(toText(process.env.FAL_KEY || process.env.FAL_BILLING_KEY || ""));
}

async function firstAvailableBinary(candidates, args = ["--version"]) {
  for (const candidate of candidates.filter(Boolean)) {
    if (await hasBinary(candidate, args)) return candidate;
  }
  return "";
}

async function hasAudioToolchain() {
  const ffprobe = await firstAvailableBinary([
    toText(process.env.FFPROBE_BIN),
    "ffprobe",
    "/nix/var/nix/profiles/default/bin/ffprobe",
    "/root/.nix-profile/bin/ffprobe",
    "/usr/bin/ffprobe",
  ]);
  const ffmpeg = await firstAvailableBinary([
    toText(process.env.FFMPEG_BIN),
    "ffmpeg",
    "/nix/var/nix/profiles/default/bin/ffmpeg",
    "/root/.nix-profile/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ]);
  if (ffprobe) process.env.FFPROBE_BIN = ffprobe;
  if (ffmpeg) process.env.FFMPEG_BIN = ffmpeg;
  return Boolean(ffprobe && ffmpeg);
}

async function hasYtDlpBinary() {
  const home = os.homedir();
  const candidates = [
    toText(process.env.YT_DLP_BIN),
    "yt-dlp",
    path.join(home, ".local/bin/yt-dlp"),
    path.join(home, "Library/Python/3.14/bin/yt-dlp"),
    path.join(home, "Library/Python/3.13/bin/yt-dlp"),
    path.join(home, "Library/Python/3.12/bin/yt-dlp"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["--version"], { timeout: 5000, maxBuffer: 256 * 1024 });
      return candidate;
    } catch {}
  }
  return "";
}

function pickFormatUrl(payload) {
  const direct = toText(payload?.url);
  if (direct && /^https?:\/\//i.test(direct)) return direct;

  const requested = Array.isArray(payload?.requested_formats) ? payload.requested_formats : [];
  for (const format of requested) {
    const url = toText(format?.url);
    if (url && /^https?:\/\//i.test(url)) return url;
  }

  const formats = Array.isArray(payload?.formats) ? payload.formats : [];
  for (const format of [...formats].reverse()) {
    const url = toText(format?.url);
    const ext = toText(format?.ext);
    const vcodec = toText(format?.vcodec);
    if (url && /^https?:\/\//i.test(url) && (ext === "mp4" || (vcodec && vcodec !== "none"))) return url;
  }

  return null;
}

async function resolveMediaLocatorViaYtDlp(url) {
  const target = toText(url);
  const binary = toText(process.env.YT_DLP_BIN) || await hasYtDlpBinary();
  if (!target || !binary) return null;
  try {
    const { stdout } = await execFileAsync(
      binary,
      ["-J", "--no-warnings", "--skip-download", target],
      { timeout: 45000, maxBuffer: 8 * 1024 * 1024 },
    );
    const payload = JSON.parse(stdout);
    const mediaUrl = pickFormatUrl(payload);
    if (!mediaUrl) return null;
    return {
      media_url: mediaUrl,
      title: toText(payload?.title),
      author: toText(payload?.uploader) || toText(payload?.channel),
      duration_sec: Number.isFinite(Number(payload?.duration)) ? Number(payload.duration) : null,
      extractor: toText(payload?.extractor_key) || toText(payload?.extractor),
      source: "yt_dlp",
    };
  } catch (error) {
    console.info(JSON.stringify({
      ok: false,
      stage: "yt_dlp_resolve_failed",
      url: target,
      binary,
      error: String(error?.message || error).slice(0, 240),
      stderr: String(error?.stderr || "").slice(0, 500) || null,
    }));
    return null;
  }
}

async function resolveAccessibleMediaUrl(mediaUrl, sourceUrl) {
  const preferred = toText(mediaUrl);
  if (preferred && await isDirectMediaReachable(preferred)) {
    return preferred;
  }

  const source = toText(sourceUrl);
  if (!source) return preferred || null;

  const resolved = await resolveMediaLocatorViaYtDlp(source);
  const fresh = toText(resolved?.media_url);
  if (!fresh) return preferred || null;
  if (await isDirectMediaReachable(fresh)) return fresh;
  return fresh || preferred || null;
}

async function uploadBytesToFalStorage(key, bytes, contentType, fileName) {
  const init = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content_type: contentType,
      file_name: fileName,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!init.ok) throw new Error(`fal_storage_init_${init.status}`);
  const payload = await init.json().catch(() => ({}));
  const uploadUrl = toText(payload?.upload_url);
  const fileUrl = toText(payload?.file_url);
  if (!uploadUrl || !fileUrl) throw new Error("fal_storage_missing_urls");
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: bytes,
    signal: AbortSignal.timeout(90_000),
  });
  if (!put.ok) throw new Error(`fal_storage_put_${put.status}`);
  return fileUrl;
}

async function downloadVideoViaYtDlp(sourceUrl) {
  const target = toText(sourceUrl);
  const binary = toText(process.env.YT_DLP_BIN) || await hasYtDlpBinary();
  if (!target || !binary) throw new Error("ytdlp_unavailable");

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "reels-brain-ytdlp-"));
  const outputTemplate = path.join(tmpDir, "video.%(ext)s");
  try {
    await execFileAsync(
      binary,
      [
        "--no-warnings",
        "--no-playlist",
        "-f", "mp4/best",
        "-o", outputTemplate,
        target,
      ],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
    );
    const filePath = path.join(tmpDir, "video.mp4");
    const bytes = await readFile(filePath);
    return {
      bytes,
      contentType: "video/mp4",
      fileName: "reels-brain-video.mp4",
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeFal(audioUrl, language = "ru", options = {}) {
  const key = toText(process.env.FAL_KEY || process.env.FAL_BILLING_KEY || "");
  if (!key || !audioUrl) return { text: null, error: key ? "missing_audio_url" : "FAL_KEY не настроен" };

  async function uploadToFalStorage(sourceUrl) {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`media_fetch_${response.status}`);
    const contentType = toText(response.headers.get("content-type")) || "video/mp4";
    const bytes = Buffer.from(await response.arrayBuffer());
    return uploadBytesToFalStorage(
      key,
      bytes,
      contentType,
      contentType.startsWith("audio/") ? "reels-brain-audio" : "reels-brain-video.mp4",
    );
  }

  let targetUrl = audioUrl;
  if (!/fal\.(ai|media)|fal\.run/i.test(audioUrl)) {
    try {
      targetUrl = await uploadToFalStorage(audioUrl);
    } catch (error) {
      const uploadError = String(error?.message || error).slice(0, 120);
      const sourceUrl = toText(options.sourceUrl);
      if (sourceUrl && /media_fetch_40[13]/.test(uploadError)) {
        try {
          const fallback = await downloadVideoViaYtDlp(sourceUrl);
          targetUrl = await uploadBytesToFalStorage(key, fallback.bytes, fallback.contentType, fallback.fileName);
        } catch (fallbackError) {
          return {
            text: null,
            error: `fal_rehost_${uploadError}; ytdlp_${String(fallbackError?.message || fallbackError).slice(0, 120)}`,
          };
        }
      } else {
        return { text: null, error: `fal_rehost_${uploadError}` };
      }
    }
  }

  try {
    const response = await fetch("https://fal.run/fal-ai/whisper", {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audio_url: targetUrl, task: "transcribe", language }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!response.ok) return { text: null, error: `whisper ${response.status}` };
    const payload = await response.json().catch(() => ({}));
    return { text: toText(payload?.text || "") || null, error: null };
  } catch (error) {
    return { text: null, error: String(error?.message || error).slice(0, 120) };
  }
}

async function probeMediaAudio(url) {
  try {
    const { stdout } = await execFileAsync(
      toText(process.env.FFPROBE_BIN) || "ffprobe",
      ["-v", "error", "-show_format", "-show_streams", "-of", "json", url],
      { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function parseSilenceSegments(stderr) {
  const starts = Array.from(stderr.matchAll(/silence_start:\s*([0-9.]+)/g)).map((match) => parseNumber(match[1]));
  const ends = Array.from(stderr.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g))
    .map((match) => ({
      end_sec: parseNumber(match[1]),
      duration_sec: parseNumber(match[2]),
    }));
  const segments = [];
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

async function inspectAudioLevels(url) {
  try {
    const { stderr } = await execFileAsync(
      toText(process.env.FFMPEG_BIN) || "ffmpeg",
      ["-v", "info", "-i", url, "-vn", "-af", "volumedetect,silencedetect=n=-35dB:d=0.20", "-f", "null", "-"],
      { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 },
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
      silence_segments: [],
    };
  }
}

async function extractAudioFeaturesLocally(mediaUrl, options = {}) {
  const target = text(await resolveAccessibleMediaUrl(mediaUrl, options.sourceUrl || ""), 1500);
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
  if (isImageLikeUrl(target)) {
    return {
      ok: false,
      media_status: "audio_failed",
      audio_status: "audio_failed",
      transcript_status: "transcript_pending",
      audio_features: null,
      transcript: null,
      error: "image_media_locator",
    };
  }

  let transcript = null;
  let transcriptError = null;
  let transcriptStatus = "transcript_pending";
  if (options.transcribe) {
    const transcribed = await transcribeFal(target, options.language || "ru", { sourceUrl: options.sourceUrl || "" });
    transcript = transcribed.text;
    transcriptError = transcribed.error || null;
    transcriptStatus = transcript ? "transcript_ready" : (transcriptError ? "transcript_failed" : "transcript_pending");
  }

  if (!options.toolchainReady) {
    return {
      ok: Boolean(transcript),
      media_status: transcript ? "media_downloaded" : "audio_failed",
      audio_status: "audio_failed",
      transcript_status: transcriptStatus,
      audio_features: transcript ? {
        media_url: target,
        stream_access: "remote_stream",
        extractor: "fal_whisper",
        transcript_source: transcript ? "fal_whisper" : null,
        transcript_error: transcriptError,
        extracted_at: new Date().toISOString(),
      } : null,
      transcript,
      error: transcriptError,
    };
  }

  const probe = await probeMediaAudio(target);
  if (!probe) {
    return {
      ok: Boolean(transcript),
      media_status: "audio_failed",
      audio_status: "audio_failed",
      transcript_status: transcriptStatus,
      audio_features: null,
      transcript,
      error: ["ffprobe_unavailable", transcriptError].filter(Boolean).join("; "),
    };
  }

  const audioStream = Array.isArray(probe.streams)
    ? probe.streams.find((stream) => stream?.codec_type === "audio")
    : null;
  if (!audioStream) {
    return {
      ok: Boolean(transcript),
      media_status: "audio_failed",
      audio_status: "audio_failed",
      transcript_status: transcriptStatus,
      audio_features: null,
      transcript,
      error: ["audio_stream_missing", transcriptError].filter(Boolean).join("; "),
    };
  }

  const audioLevels = await inspectAudioLevels(target);
  const silenceSegments = Array.isArray(audioLevels.silence_segments) ? audioLevels.silence_segments : [];
  const totalSilence = silenceSegments.reduce((sum, segment) => sum + (parseNumber(segment?.duration_sec) || 0), 0);
  const audioDuration = parseNumber(audioStream.duration) ?? parseNumber(probe.format?.duration);
  const transcriptWords = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  const wordsPerSecond = transcriptWords && audioDuration ? Number((transcriptWords / Math.max(audioDuration, 1)).toFixed(2)) : null;

  return {
    ok: true,
    media_status: "media_downloaded",
    audio_status: "audio_extracted",
    transcript_status: transcriptStatus,
    transcript,
    error: transcriptError,
    audio_features: {
      media_url: target,
      stream_access: "remote_stream",
      extractor: "ffprobe+ffmpeg",
      has_audio_stream: true,
      media_duration_sec: parseNumber(probe.format?.duration),
      audio_duration_sec: audioDuration,
      sample_rate_hz: parseNumber(audioStream.sample_rate),
      channels: parseNumber(audioStream.channels),
      bit_rate_kbps: (() => {
        const streamBitrate = parseNumber(audioStream.bit_rate);
        const formatBitrate = parseNumber(probe.format?.bit_rate);
        const chosen = streamBitrate ?? formatBitrate;
        return chosen ? Number((chosen / 1000).toFixed(1)) : null;
      })(),
      mean_volume_db: audioLevels.mean_volume_db,
      max_volume_db: audioLevels.max_volume_db,
      first_sound_sec: audioLevels.first_sound_sec,
      first_speech_event_sec: transcript ? audioLevels.first_sound_sec : null,
      silence_segments: silenceSegments,
      pause_count: silenceSegments.length,
      long_pause_count: silenceSegments.filter((segment) => (parseNumber(segment?.duration_sec) || 0) >= 0.7).length,
      dead_air_ratio_pct: audioDuration ? Number(((totalSilence / Math.max(audioDuration, 0.01)) * 100).toFixed(2)) : null,
      pacing_tier: wordsPerSecond == null ? "unknown" : wordsPerSecond >= 3.2 ? "fast" : wordsPerSecond >= 2 ? "medium" : "slow",
      beat_density_hint: audioLevels.first_sound_sec == null ? "unknown" : audioLevels.first_sound_sec <= 0.25 ? "high" : audioLevels.first_sound_sec <= 0.8 ? "medium" : "low",
      transcript_source: transcript ? "fal_whisper" : null,
      transcript_error: transcriptError,
      words_per_second: wordsPerSecond,
      extracted_at: new Date().toISOString(),
    },
  };
}

async function fetchJson(url, init = {}, timeoutMs = 115_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function heartbeatPayload(config, progress, note, blocker = "") {
  return {
    worker_id: config.workerId,
    label: config.label,
    status: blocker ? "blocked" : "working",
    branch: toText(process.env.WORKER_BRANCH || ""),
    pr: toText(process.env.WORKER_PR || ""),
    current_task_id: config.taskId,
    current_task_title: config.taskTitle,
    progress,
    blocker,
    note,
    queue: [],
  };
}

async function postHeartbeat(config, progress, note, blocker = "") {
  if (!config.heartbeat) return;
  const payload = heartbeatPayload(config, progress, note, blocker);
  const response = await fetchJson(`${config.baseUrl}/api/factory/worker-state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.secret}`,
    },
    body: JSON.stringify(payload),
  }, 15_000);
  if (!response.ok) {
    console.error(JSON.stringify({
      ok: false,
      stage: "heartbeat",
      status: response.status,
      body: response.json,
    }));
  }
}

async function runCycle(config, cycle) {
  const mode = config.mode === "mixed"
    ? (cycle % 2 === 1 ? "media" : "audio")
    : config.mode;
  const platformIndex = config.mode === "mixed"
    ? Math.floor((cycle - 1) / 2) % config.platforms.length
    : (cycle - 1) % config.platforms.length;
  const platform = config.platforms[platformIndex] || config.platform;
  const provider = config.mediaProviders[platform] || config.provider;
  const route = mode === "audio"
    ? "/api/factory/jobs/reels-brain-audio-backfill"
    : "/api/factory/jobs/reels-brain-media-backfill";
  const url = new URL(route, config.baseUrl);
  url.searchParams.set("platform", platform);
  url.searchParams.set("niches", config.niches);
  const limit = mode === "audio" ? config.audioLimit : config.mediaLimit;
  const scan = mode === "audio" ? config.audioScan : config.mediaScan;
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("scan", String(scan));
  if (mode === "audio") {
    url.searchParams.set("transcribe", config.transcribe ? "1" : "0");
    url.searchParams.set("language", config.language);
  } else {
    url.searchParams.set("provider", provider);
    url.searchParams.set("use_local_resolver", config.useLocalResolver ? "1" : "0");
  }

  await postHeartbeat(
    config,
    `cycle ${cycle}: ${platform} ${mode} backfill`,
    mode === "audio"
      ? `transcribe=${config.transcribe ? "on" : "off"} limit=${limit} scan=${scan}`
      : `provider=${provider} limit=${limit} scan=${scan}`,
  );

  if (mode === "audio" && config.localAudioEnabled) {
    url.searchParams.set("dry_run", "1");
  }

  const result = await fetchJson(url.toString(), {
    headers: { Authorization: `Bearer ${config.secret}` },
  });

  const body = result.json && typeof result.json === "object" ? result.json : {};
  const runs = Array.isArray(body.runs) ? body.runs : [];
  let locallyResolved = 0;
  let locallyExtracted = 0;
  let localTranscriptReady = 0;
  const localAudioSamples = [];

  if (mode === "media" && config.useLocalResolver && config.localResolverAvailable) {
    for (const run of runs) {
      const targetUrl = toText(run?.url);
      const rowId = Number(run?.id || 0);
      const matchedWithMedia = Number(run?.matched_with_media || 0) || 0;
      if (!targetUrl || !rowId || matchedWithMedia > 0) continue;

      const resolved = await resolveMediaLocatorViaYtDlp(targetUrl);
      if (!resolved?.media_url) continue;

      const commit = await fetchJson(`${config.baseUrl}/api/factory/jobs/reels-brain-media-commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.secret}`,
        },
        body: JSON.stringify({
          id: rowId,
          url: targetUrl,
          platform,
          media_url: resolved.media_url,
          title: resolved.title,
          author: resolved.author,
          duration_sec: resolved.duration_sec,
        }),
      });
      if (commit.ok) locallyResolved += 1;
    }
  }

  if (mode === "audio" && config.localAudioEnabled) {
    for (const run of runs) {
      const mediaUrl = toText(run?.media_url);
      const rowId = Number(run?.id || 0);
      if (!mediaUrl || !rowId || isImageLikeUrl(mediaUrl)) continue;

      const extracted = await extractAudioFeaturesLocally(mediaUrl, {
        sourceUrl: run?.url,
        transcribe: config.transcribe,
        language: config.language,
        toolchainReady: config.localAudioToolchainReady,
      });
      const resolvedMediaUrl = toText(extracted?.audio_features?.media_url) || mediaUrl;
      const commit = await fetchJson(`${config.baseUrl}/api/factory/jobs/reels-brain-audio-commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.secret}`,
        },
        body: JSON.stringify({
          id: rowId,
          media_url: resolvedMediaUrl,
          media_status: extracted.media_status,
          audio_status: extracted.audio_status,
          transcript_status: extracted.transcript_status,
          transcript: extracted.transcript,
          audio_features: extracted.audio_features,
          error: extracted.error,
        }),
      });
      if (commit.ok && extracted.audio_status === "audio_extracted") locallyExtracted += 1;
      if (commit.ok && extracted.transcript_status === "transcript_ready") localTranscriptReady += 1;
      if (localAudioSamples.length < 3) {
        localAudioSamples.push({
          id: rowId,
          platform: run?.platform || platform,
          source_url: toText(run?.url),
          original_media_url: mediaUrl,
          resolved_media_url: resolvedMediaUrl,
          audio_status: extracted.audio_status,
          transcript_status: extracted.transcript_status,
          transcript_words: extracted.transcript ? extracted.transcript.split(/\s+/).filter(Boolean).length : 0,
          error: extracted.error || null,
          commit_ok: commit.ok,
        });
      }
    }
  }

  const attempted = Number(body.attempted || 0) || 0;
  const withMedia = Number(body.rows_with_media || 0) || 0;
  const enriched = Number(body.enriched || 0) || 0;
  const inserted = Number(body.inserted || 0) || 0;
  const extracted = Number(body.extracted || 0) || 0;
  const transcriptReady = Number(body.transcript_ready || 0) || 0;
  const note = mode === "audio"
    ? `attempted=${attempted} extracted=${config.localAudioEnabled ? locallyExtracted : extracted} transcript_ready=${config.localAudioEnabled ? localTranscriptReady : transcriptReady} failed=${Number(body.failed || 0) || 0}`
    : `attempted=${attempted} with_media=${withMedia} enriched=${enriched} inserted=${inserted} local_commits=${locallyResolved}`;
  await postHeartbeat(config, `cycle ${cycle}: completed`, note, result.ok ? "" : `http_${result.status}`);

  console.log(JSON.stringify({
    ok: result.ok,
    cycle,
    mode,
    platform_index: platformIndex,
    platforms: config.platforms,
    provider,
    platform,
    attempted,
    with_media: withMedia,
    enriched,
    inserted,
    extracted: config.localAudioEnabled ? locallyExtracted : extracted,
    transcript_ready: config.localAudioEnabled ? localTranscriptReady : transcriptReady,
    local_commits: locallyResolved,
    local_audio_enabled: config.localAudioEnabled,
    local_audio_toolchain_ready: config.localAudioToolchainReady,
    local_audio_extracted: locallyExtracted,
    local_audio_samples: localAudioSamples,
    local_resolver_enabled: body.local_resolver_enabled || false,
    local_resolver_available: config.localResolverAvailable,
    sample: runs.slice(0, 2),
    status: result.status,
  }));

  return { ok: result.ok, body };
}

const opts = parseArgs(process.argv);
if (opts.help) {
  usage();
  process.exit(0);
}

const config = {
  baseUrl: String(opts.base || process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, ""),
  secret: String(opts.secret || process.env.CRON_SECRET || ""),
  mode: (() => {
    const raw = toText(opts.mode || process.env.REELS_BRAIN_OFFLINE_MODE || "media");
    return raw === "audio" || raw === "mixed" ? raw : "media";
  })(),
  provider: toText(opts.provider || process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER || "apify_instagram"),
  platform: toText(opts.platform || process.env.REELS_BRAIN_MEDIA_BACKFILL_PLATFORM || "instagram"),
  platforms: (() => {
    const values = splitCsv(opts.platforms || process.env.REELS_BRAIN_PLATFORMS || opts.platform || process.env.REELS_BRAIN_MEDIA_BACKFILL_PLATFORM || "instagram");
    return values.length ? values : ["instagram"];
  })(),
  niches: toText(opts.niches || process.env.REELS_BRAIN_NICHES || "ru_toys,ru_clothing,ru_cosmetics"),
  limit: intFlag(opts.limit || process.env.REELS_BRAIN_MEDIA_BACKFILL_LIMIT || 3, 3, 1, 10),
  scan: intFlag(opts.scan || process.env.REELS_BRAIN_MEDIA_BACKFILL_SCAN || 30, 30, 1, 200),
  mediaLimit: intFlag(opts["media-limit"] || process.env.REELS_BRAIN_MEDIA_BACKFILL_LIMIT || 3, 3, 1, 10),
  mediaScan: intFlag(opts["media-scan"] || process.env.REELS_BRAIN_MEDIA_BACKFILL_SCAN || 30, 30, 1, 200),
  audioLimit: intFlag(opts["audio-limit"] || process.env.REELS_BRAIN_AUDIO_BACKFILL_LIMIT || 2, 2, 1, 8),
  audioScan: intFlag(opts["audio-scan"] || process.env.REELS_BRAIN_AUDIO_BACKFILL_SCAN || 18, 18, 1, 120),
  localAudioPreferred: boolFlag(opts["local-audio"] ?? process.env.REELS_BRAIN_AUDIO_LOCAL ?? "1", true),
  transcribe: boolFlag(opts.transcribe ?? process.env.REELS_BRAIN_AUDIO_TRANSCRIBE ?? "1", true),
  language: toText(opts.language || process.env.REELS_BRAIN_AUDIO_LANGUAGE || "ru") || "ru",
  everySec: intFlag(opts["every-sec"] || process.env.REELS_BRAIN_OFFLINE_LOOP_EVERY_SEC || 0, 0, 0, 86_400),
  maxCycles: intFlag(opts["max-cycles"] || process.env.REELS_BRAIN_OFFLINE_MAX_CYCLES || 0, 0, 0, 100_000),
  once: boolFlag(opts.once, false),
  useLocalResolver: boolFlag(opts["use-local-resolver"] ?? process.env.REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER, false),
  heartbeat: boolFlag(opts.heartbeat ?? process.env.REELS_BRAIN_OFFLINE_HEARTBEAT ?? "1", true),
  workerId: toText(opts["worker-id"] || process.env.WORKER_ID || "reels-brain-offline-worker"),
  label: toText(opts.label || process.env.WORKER_LABEL || "Reels Brain Offline Worker"),
  taskId: toText(opts["task-id"] || process.env.WORKER_TASK_ID || "RB-OFFLINE-001"),
  taskTitle: toText(opts["task-title"] || process.env.WORKER_TASK_TITLE || "Media locator backfill via offline worker"),
};

config.mediaProviders = {
  instagram: toText(process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_INSTAGRAM || config.provider || "bright_instagram"),
  tiktok: toText(process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_TIKTOK || "apify_tiktok"),
  youtube: toText(process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_YOUTUBE || "apify_youtube"),
};

if (!config.baseUrl) {
  console.error("BASE_URL is required");
  process.exit(1);
}
if (!config.secret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

config.localResolverBinary = config.useLocalResolver ? await hasYtDlpBinary() : "";
config.localResolverAvailable = Boolean(config.localResolverBinary);
config.localAudioToolchainReady = config.localAudioPreferred ? await hasAudioToolchain() : false;
config.localAudioEnabled = config.localAudioPreferred
  ? (config.localAudioToolchainReady || (config.transcribe && falConfigured()))
  : false;
if (config.localResolverBinary) {
  process.env.YT_DLP_BIN = config.localResolverBinary;
}

if (!config.everySec || config.once) {
  await runCycle(config, 1);
  process.exit(0);
}

let cycle = 0;
while (true) {
  cycle += 1;
  try {
    await runCycle(config, cycle);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 220);
    await postHeartbeat(config, `cycle ${cycle}: failed`, "offline worker cycle failed", message);
    console.error(JSON.stringify({ ok: false, cycle, error: message }));
  }
  if (config.maxCycles > 0 && cycle >= config.maxCycles) break;
  await sleep(config.everySec * 1000);
}
