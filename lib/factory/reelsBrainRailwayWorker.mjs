#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { summarizeReelsMediaAssets } from "./reelsBrainMediaAssetResolver.mjs";

const DEFAULT_BASE_URL = "https://finance-panel-two.vercel.app";
const DEFAULT_NICHES = "ru_toys,ru_clothing,ru_cosmetics";
const DEFAULT_PLATFORMS = "tiktok,instagram,youtube";

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[arg.slice(2)] = next;
      i += 1;
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

function bool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (value === true) return true;
  const text = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(text);
}

function numberEnv(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compact(value, max = 900) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function summarizeForLog(value) {
  if (!value || typeof value !== "object") return value;
  return {
    ok: value.ok,
    mode: value.mode,
    action: value.action,
    status: value.status,
    done: value.done,
    found: value.found,
    inserted: value.inserted,
    analyzed: value.analyzed,
    relevant: value.relevant,
    persisted: value.persisted,
    summary: value.summary || value.replay?.summary || null,
    probed: value.probed,
    succeeded: value.succeeded,
    failed: value.failed,
    error_samples: Array.isArray(value.error_samples) ? value.error_samples.slice(0, 3) : undefined,
    persisted_summary: value.persisted ? {
      inserted: value.persisted.inserted,
      media_updated: value.persisted.media_updated,
      normalized: value.persisted.normalized,
      rejected: value.persisted.rejected,
      assets_found: value.persisted.assets_found,
    } : undefined,
  };
}

const opts = parseArgs(process.argv);
const baseUrl = String(opts.base || process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const secret = String(opts.secret || process.env.CRON_SECRET || "");
const workerId = String(process.env.WORKER_ID || "railway-reels-brain-offline");
const label = String(process.env.WORKER_LABEL || "Reels Brain Offline Workers");
const niches = String(opts.niches || process.env.REELS_BRAIN_NICHES || DEFAULT_NICHES);
const platforms = String(opts.platforms || process.env.REELS_BRAIN_PLATFORMS || DEFAULT_PLATFORMS);
const loopEverySec = numberEnv("REELS_BRAIN_LOOP_EVERY_SEC", 600, 60, 86_400);
const analyzeLimit = numberEnv("REELS_BRAIN_ANALYZE_LIMIT", 25, 1, 25);
const maxLanes = numberEnv("REELS_BRAIN_MAX_LANES", 9, 1, 9);
const patternLimit = numberEnv("REELS_BRAIN_PATTERN_LIMIT", 3000, 10, 3000);
const mediaResolveLimit = numberEnv("REELS_BRAIN_MEDIA_RESOLVE_LIMIT", 60, 1, 200);
const mediaResolverLimit = numberEnv("REELS_BRAIN_APIFY_MEDIA_RESOLVER_LIMIT", 1, 1, 20);
const mediaResolverPollSec = numberEnv("REELS_BRAIN_APIFY_MEDIA_RESOLVER_POLL_SEC", 240, 30, 1200);
const avProbeLimit = numberEnv("REELS_BRAIN_AV_PROBE_LIMIT", 10, 0, 50);
const avProbeMaxBytes = numberEnv("REELS_BRAIN_AV_PROBE_MAX_MB", 80, 5, 500) * 1024 * 1024;
const enableBulk = bool(opts.bulk ?? process.env.REELS_BRAIN_ENABLE_BULK, false);
const enableMediaResolver = bool(opts.mediaResolver ?? process.env.REELS_BRAIN_ENABLE_MEDIA_RESOLVER, false);
const enableAvProbe = bool(process.env.REELS_BRAIN_ENABLE_AV_PROBE, true);
const buildPatterns = bool(process.env.REELS_BRAIN_BUILD_PATTERNS, true);
const once = bool(opts.once, false);

function nicheList() {
  return niches.split(",").map((row) => row.trim()).filter(Boolean);
}

function mediaResolverQueryForNiche(niche) {
  const explicit = String(process.env.REELS_BRAIN_APIFY_MEDIA_RESOLVER_QUERY || "").trim();
  if (explicit) return explicit.replace(/\{niche\}/g, niche);
  const key = niche.toLowerCase();
  if (key.includes("toy")) return "детские игрушки обзор";
  if (key.includes("cloth")) return "примерка одежды обзор";
  if (key.includes("cosmetic")) return "косметика обзор макияж";
  return `${niche.replace(/^ru_/, "").replace(/_/g, " ")} обзор`;
}

function splitLimit(total, buckets, index) {
  const safeBuckets = Math.max(1, buckets);
  const base = Math.floor(total / safeBuckets);
  const rest = total % safeBuckets;
  return Math.max(1, base + (index < rest ? 1 : 0));
}

if (opts.help) {
  console.log(`Usage:
  BASE_URL=https://finance-panel-two.vercel.app CRON_SECRET=... node lib/factory/reelsBrainRailwayWorker.mjs --once
  BASE_URL=https://finance-panel-two.vercel.app CRON_SECRET=... node lib/factory/reelsBrainRailwayWorker.mjs

Env:
  BASE_URL                         Product URL, defaults to ${DEFAULT_BASE_URL}
  CRON_SECRET                      Required bearer token for protected factory jobs
  REELS_BRAIN_NICHES               Default: ${DEFAULT_NICHES}
  REELS_BRAIN_PLATFORMS            Default: ${DEFAULT_PLATFORMS}
  REELS_BRAIN_LOOP_EVERY_SEC       Default: 600
  REELS_BRAIN_ANALYZE_LIMIT        Default/max: 25 per lane
  REELS_BRAIN_MAX_LANES            Default/max: 9
  REELS_BRAIN_PATTERN_LIMIT        Default/max: 3000 per niche
  REELS_BRAIN_MEDIA_RESOLVE_LIMIT  Default/max: 60 corpus rows per cycle
  REELS_BRAIN_ENABLE_MEDIA_RESOLVER Default false, true starts async Apify video resolver
  REELS_BRAIN_APIFY_MEDIA_RESOLVER_LIMIT Default/max: 1/20 videos per resolver run
  REELS_BRAIN_APIFY_MEDIA_RESOLVER_POLL_SEC Default/max: 240/1200
  REELS_BRAIN_ENABLE_AV_PROBE    Default true, runs lightweight ffprobe on ready mp4 assets
  REELS_BRAIN_AV_PROBE_LIMIT     Default/max: 10/20 assets per cycle
  REELS_BRAIN_AV_PROBE_MAX_MB    Default/max: 80/500 MB per asset
  REELS_BRAIN_ENABLE_BULK          Default false, true allows paid corpus growth provider calls
  REELS_BRAIN_BUILD_PATTERNS       Default true
`);
  process.exit(0);
}

if (!secret) {
  console.error("CRON_SECRET is required for Railway Reels Brain worker");
  process.exit(1);
}

async function request(path, init = {}) {
  const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(Number(init.timeoutMs || 120_000)),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 1000) };
  }
  if (!res.ok) {
    const error = new Error(`${res.status} ${res.statusText}: ${compact(body, 500)}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

function execFileJson(command, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`invalid ${command} json: ${String(error?.message || error)}`));
      }
    });
  });
}

function execFileText(command, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function commandAvailable(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ["-version"], { stdio: ["ignore", "ignore", "ignore"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 5_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function signedAssetUrl(assetUrl) {
  const token = String(process.env.APIFY_TOKEN || "").trim();
  if (!token) return assetUrl;
  try {
    const url = new URL(assetUrl);
    if (url.hostname !== "api.apify.com") return assetUrl;
    if (!url.pathname.includes("/key-value-stores/") || !url.pathname.includes("/records/")) return assetUrl;
    if (!url.searchParams.has("token")) url.searchParams.set("token", token);
    return url.href;
  } catch {
    return assetUrl;
  }
}

async function downloadUrl(assetUrl) {
  const local = signedAssetUrl(assetUrl);
  if (local !== assetUrl) return local;
  try {
    const url = new URL(assetUrl);
    if (url.hostname !== "api.apify.com") return assetUrl;
    if (!url.pathname.includes("/key-value-stores/") || !url.pathname.includes("/records/")) return assetUrl;
    const signed = await request("/api/factory/reels-brain/media-assets/sign", {
      method: "POST",
      timeoutMs: 30_000,
      body: JSON.stringify({ asset_url: assetUrl }),
    });
    return String(signed?.signed_url || assetUrl);
  } catch {
    return assetUrl;
  }
}

async function downloadAssetToTemp(assetUrl, maxBytes) {
  const res = await fetch(await downloadUrl(assetUrl), { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`download ${res.status} ${res.statusText}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > maxBytes) throw new Error(`asset too large: ${Math.round(len / 1024 / 1024)}MB`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > maxBytes) throw new Error(`asset too large: ${Math.round(buffer.byteLength / 1024 / 1024)}MB`);
  const dir = await mkdtemp(path.join(tmpdir(), "reels-av-"));
  const file = path.join(dir, "asset.mp4");
  await writeFile(file, buffer);
  return { dir, file, bytes: buffer.byteLength };
}

function streamSummary(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((row) => row.codec_type === "video") || null;
  const audio = streams.find((row) => row.codec_type === "audio") || null;
  const fpsParts = String(video?.avg_frame_rate || video?.r_frame_rate || "0/0").split("/").map(Number);
  const fps = fpsParts[1] ? Math.round((fpsParts[0] / fpsParts[1]) * 100) / 100 : 0;
  return {
    duration_sec: Math.round(Number(probe?.format?.duration || video?.duration || audio?.duration || 0) * 10) / 10,
    size_mb: Math.round(Number(probe?.format?.size || 0) / 1024 / 1024 * 10) / 10,
    format: String(probe?.format?.format_name || ""),
    has_video: !!video,
    has_audio: !!audio,
    width: Number(video?.width || 0) || null,
    height: Number(video?.height || 0) || null,
    fps: fps || null,
    video_codec: video?.codec_name || null,
    audio_codec: audio?.codec_name || null,
    audio_channels: audio?.channels || null,
    audio_sample_rate: audio?.sample_rate ? Number(audio.sample_rate) : null,
  };
}

function numberMatch(text, pattern) {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseSilence(stderr, analyzedSec) {
  const starts = [...stderr.matchAll(/silence_start:\s*([0-9.]+)/g)].map((row) => Number(row[1])).filter(Number.isFinite);
  const ends = [...stderr.matchAll(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g)]
    .map((row) => ({ end: Number(row[1]), duration: Number(row[2]) }))
    .filter((row) => Number.isFinite(row.end) && Number.isFinite(row.duration));
  const totalSilence = Math.round(ends.reduce((sum, row) => sum + row.duration, 0) * 10) / 10;
  const firstSilenceStart = starts.length ? Math.round(starts[0] * 10) / 10 : null;
  const startsWithSound = firstSilenceStart == null || firstSilenceStart > 0.4;
  return {
    silence_events: starts.length,
    total_silence_sec: totalSilence,
    silence_share_pct: analyzedSec ? Math.round((totalSilence / analyzedSec) * 100) : 0,
    first_silence_start_sec: firstSilenceStart,
    sound_starts_immediately: startsWithSound,
  };
}

function parseSceneChanges(stderr, analyzedSec) {
  const changes = (stderr.match(/showinfo/g) || []).length;
  return {
    scene_change_count: changes,
    cut_density_per_10s: analyzedSec ? Math.round((changes / analyzedSec) * 100) / 10 : 0,
    edit_pace: changes >= 18 ? "fast" : changes >= 7 ? "medium" : "slow",
  };
}

function parseBlackFrames(stderr) {
  const starts = [...stderr.matchAll(/black_start:\s*([0-9.]+)/g)].map((row) => Number(row[1])).filter(Number.isFinite);
  return {
    black_segments: starts.length,
    starts_with_black: starts.some((value) => value <= 0.2),
  };
}

async function lightweightAudioVisualFeatures(file, summary) {
  const analyzedSec = Math.max(1, Math.min(20, Number(summary.duration_sec || 20)));
  const features = {
    analyzed_sec: analyzedSec,
    audio: null,
    visual: null,
  };

  if (summary.has_audio) {
    const [volume, silence] = await Promise.allSettled([
      execFileText("ffmpeg", ["-hide_banner", "-t", String(analyzedSec), "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], 45_000),
      execFileText("ffmpeg", ["-hide_banner", "-t", String(analyzedSec), "-i", file, "-af", "silencedetect=n=-35dB:d=0.25", "-vn", "-f", "null", "-"], 45_000),
    ]);
    const volumeText = volume.status === "fulfilled" ? volume.value.stderr : "";
    const silenceText = silence.status === "fulfilled" ? silence.value.stderr : "";
    const meanVolume = numberMatch(volumeText, /mean_volume:\s*(-?[0-9.]+)\s*dB/);
    const maxVolume = numberMatch(volumeText, /max_volume:\s*(-?[0-9.]+)\s*dB/);
    features.audio = {
      mean_volume_db: meanVolume,
      max_volume_db: maxVolume,
      loudness_bucket: meanVolume == null ? "unknown" : meanVolume >= -18 ? "loud" : meanVolume >= -28 ? "balanced" : "quiet",
      ...(parseSilence(silenceText, analyzedSec)),
    };
  }

  if (summary.has_video) {
    const [scene, black] = await Promise.allSettled([
      execFileText("ffmpeg", ["-hide_banner", "-t", String(analyzedSec), "-i", file, "-vf", "select=gt(scene\\,0.35),showinfo", "-an", "-f", "null", "-"], 45_000),
      execFileText("ffmpeg", ["-hide_banner", "-t", String(analyzedSec), "-i", file, "-vf", "blackdetect=d=0.1:pic_th=0.98", "-an", "-f", "null", "-"], 45_000),
    ]);
    const sceneText = scene.status === "fulfilled" ? scene.value.stderr : "";
    const blackText = black.status === "fulfilled" ? black.value.stderr : "";
    features.visual = {
      orientation: (summary.height || 0) > (summary.width || 0) ? "vertical" : (summary.width || 0) > (summary.height || 0) ? "horizontal" : "unknown",
      fps_bucket: (summary.fps || 0) >= 55 ? "55+ fps" : (summary.fps || 0) >= 28 ? "28-54 fps" : (summary.fps || 0) > 0 ? "under 28 fps" : "unknown",
      ...(parseSceneChanges(sceneText, analyzedSec)),
      ...(parseBlackFrames(blackText)),
    };
  }

  return features;
}

async function probeAsset(candidate) {
  let temp = null;
  try {
    temp = await downloadAssetToTemp(candidate.asset_url, avProbeMaxBytes);
    const raw = await execFileJson("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      temp.file,
    ], 45_000);
    const summary = streamSummary(raw);
    const features = await lightweightAudioVisualFeatures(temp.file, summary).catch((error) => ({
      analyzed_sec: Math.max(1, Math.min(20, Number(summary.duration_sec || 20))),
      error: String(error?.message || error).slice(0, 180),
      audio: null,
      visual: null,
    }));
    return {
      video_id: candidate.video_id,
      asset_url: candidate.asset_url,
      ok: true,
      probe: {
        ...summary,
        audio_features: features.audio,
        visual_features: features.visual,
        feature_probe: {
          source: "ffmpeg-lightweight",
          analyzed_sec: features.analyzed_sec,
          error: features.error || null,
        },
        downloaded_mb: Math.round(temp.bytes / 1024 / 1024 * 10) / 10,
      },
    };
  } catch (error) {
    return {
      video_id: candidate.video_id,
      asset_url: candidate.asset_url,
      ok: false,
      error: String(error?.message || error).slice(0, 300),
    };
  } finally {
    if (temp?.dir) await rm(temp.dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function heartbeat(status, progress, extra = {}) {
  const payload = {
    worker_id: workerId,
    label,
    status,
    branch: process.env.WORKER_BRANCH || "feat/reels-brain-railway-offline-workers",
    current_task_id: extra.task_id || "RB-OFFLINE",
    current_task_title: extra.task_title || "Reels Brain offline intelligence workers",
    progress,
    blocker: extra.blocker || "",
    note: extra.note || `niches=${niches}; platforms=${platforms}; bulk=${enableBulk ? "enabled" : "disabled"}`,
    queue: [
      { id: "RB-1", title: "Analyze stored backlog", status: status === "working" ? "doing" : status, priority: "P0" },
      { id: "RB-2", title: "Rebuild pattern memory", status: "todo", priority: "P0" },
      { id: "RB-3", title: "Refresh digest/readiness surfaces", status: "todo", priority: "P1" },
      { id: "RB-4", title: "Optional paid corpus growth", status: enableBulk ? "todo" : "blocked", priority: "P2", blockers: enableBulk ? [] : ["disabled by REELS_BRAIN_ENABLE_BULK=false"] },
      { id: "RB-5", title: "Optional Apify async media resolver", status: enableMediaResolver ? "todo" : "blocked", priority: "P2", blockers: enableMediaResolver ? [] : ["disabled by REELS_BRAIN_ENABLE_MEDIA_RESOLVER=false"] },
    ],
  };
  return request("/api/factory/worker-state", { method: "POST", body: JSON.stringify(payload), timeoutMs: 20_000 });
}

async function safeHeartbeat(status, progress, extra = {}) {
  try {
    return await heartbeat(status, progress, extra);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      at: new Date().toISOString(),
      kind: "heartbeat_failed_non_blocking",
      status,
      progress,
      error: String(error?.message || error).slice(0, 700),
    }));
    return null;
  }
}

async function runStep(name, fn) {
  const started = Date.now();
  await safeHeartbeat("working", `running ${name}`);
  try {
    const result = await fn();
    const durationSec = Math.round((Date.now() - started) / 1000);
    console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), step: name, duration_sec: durationSec, result: summarizeForLog(result) }, null, 2));
    await safeHeartbeat("working", `finished ${name} in ${durationSec}s`, { note: compact(result, 700) });
    return { ok: true, name, duration_sec: durationSec, result };
  } catch (error) {
    const durationSec = Math.round((Date.now() - started) / 1000);
    const message = String(error?.message || error).slice(0, 800);
    console.error(JSON.stringify({ ok: false, at: new Date().toISOString(), step: name, duration_sec: durationSec, error: message, body: error?.body || null }, null, 2));
    await safeHeartbeat("working", `step ${name} failed; continuing`, { blocker: message });
    return { ok: false, name, duration_sec: durationSec, error: message };
  }
}

async function runCycle() {
  const cycleStarted = new Date().toISOString();
  await safeHeartbeat("working", `cycle started ${cycleStarted}`);

  const results = [];
  if (enableBulk) {
    results.push(await runStep("paid corpus growth cron", () => request(
      `/api/factory/jobs/reels-brain-cron?task=bulk&target=10000&niches=${encodeURIComponent(niches)}&platforms=${encodeURIComponent(platforms)}`,
      { method: "GET", timeoutMs: 125_000 },
    )));
  } else {
    console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), step: "paid corpus growth cron", skipped: true, reason: "REELS_BRAIN_ENABLE_BULK=false" }));
  }

  if (enableMediaResolver) {
    results.push(await runStep("apify async media resolver", async () => {
      const resolverNiches = nicheList();
      const runs = [];
      for (let i = 0; i < resolverNiches.length; i += 1) {
        const niche = resolverNiches[i];
        const query = mediaResolverQueryForNiche(niche);
        const limit = splitLimit(mediaResolverLimit, resolverNiches.length, i);
        const start = await request("/api/factory/reels-brain/media-resolver/apify", {
          method: "POST",
          timeoutMs: 45_000,
          body: JSON.stringify({
            action: "start",
            niche,
            query,
            limit,
            download_videos: true,
          }),
        });
        runs.push({ niche, query, limit, latest: start, done: !start.run_id });
      }
      const deadline = Date.now() + mediaResolverPollSec * 1000;
      while (Date.now() < deadline && runs.some((row) => !row.done)) {
        await sleep(20_000);
        for (const run of runs.filter((row) => !row.done)) {
          const latest = await request("/api/factory/reels-brain/media-resolver/apify", {
            method: "POST",
            timeoutMs: 60_000,
            body: JSON.stringify({
              action: "poll",
              run_id: run.latest.run_id,
              dataset_id: run.latest.dataset_id || null,
              niche: run.niche,
              query: run.query,
              limit: run.limit,
            }),
          });
          run.latest = latest;
          run.done = latest.done || ["FAILED", "ABORTED", "TIMED-OUT"].includes(String(latest.status || ""));
        }
      }
      const finished = runs.map((run) => ({ niche: run.niche, query: run.query, limit: run.limit, ...run.latest }));
      return {
        ok: finished.every((run) => run.ok !== false),
        mode: "apify_async_media_resolver_balanced",
        found: finished.reduce((sum, run) => sum + Number(run.found || 0), 0),
        persisted: {
          media_updated: finished.reduce((sum, run) => sum + Number(run.persisted?.media_updated || 0), 0),
          normalized: finished.reduce((sum, run) => sum + Number(run.persisted?.normalized || 0), 0),
          rejected: finished.reduce((sum, run) => sum + Number(run.persisted?.rejected || 0), 0),
          assets_found: finished.reduce((sum, run) => sum + Number(run.persisted?.assets_found || 0), 0),
        },
        runs: finished.map((run) => ({
          niche: run.niche,
          status: run.status,
          done: run.done,
          found: run.found,
          persisted: run.persisted,
          error: run.error || null,
        })),
      };
    }));
  } else {
    console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), step: "apify async media resolver", skipped: true, reason: "REELS_BRAIN_ENABLE_MEDIA_RESOLVER=false" }));
  }

  results.push(await runStep("resolve media assets", async () => {
    const allVideos = [];
    for (const niche of niches.split(",").map((row) => row.trim()).filter(Boolean)) {
      const corpus = await request(`/api/factory/reels-brain/corpus?niche=${encodeURIComponent(niche)}&limit=${mediaResolveLimit}`, {
        method: "GET",
        timeoutMs: 45_000,
      });
      if (Array.isArray(corpus?.videos)) allVideos.push(...corpus.videos);
    }
    return summarizeReelsMediaAssets(allVideos);
  }));

  const mediaReportStep = await runStep("media intelligence report", () => request(
    `/api/factory/reels-brain/media-intelligence?niches=${encodeURIComponent(niches)}&limit_per_niche=${mediaResolveLimit}`,
    { method: "GET", timeoutMs: 60_000 },
  ));
  results.push(mediaReportStep);

  if (enableAvProbe && avProbeLimit > 0) {
    results.push(await runStep("audio visual ffprobe", async () => {
      if (!(await commandAvailable("ffprobe"))) {
        return { ok: false, mode: "reels_brain_audio_visual_probe", skipped: true, reason: "ffprobe_missing" };
      }
      const candidates = Array.isArray(mediaReportStep.result?.direct_asset_store?.candidates)
        ? mediaReportStep.result.direct_asset_store.candidates
        : [];
      const todo = candidates
        .filter((row) => row?.video_id && row?.asset_url && row?.asset_kind === "video" && (!row?.media_probe || (row.media_probe.ok === true && !row.media_probe.feature_probe)))
        .slice(0, avProbeLimit);
      if (!todo.length) return { ok: true, mode: "reels_brain_audio_visual_probe", skipped: true, reason: "no ready video assets" };
      const probeResults = [];
      for (const candidate of todo) probeResults.push(await probeAsset(candidate));
      const persisted = await request("/api/factory/reels-brain/audio-visual/probe", {
        method: "POST",
        timeoutMs: 90_000,
        body: JSON.stringify({ results: probeResults }),
      });
      return {
        ok: persisted.ok,
        mode: "reels_brain_audio_visual_probe",
        probed: probeResults.length,
        succeeded: probeResults.filter((row) => row.ok).length,
        failed: probeResults.filter((row) => !row.ok).length,
        error_samples: probeResults.filter((row) => !row.ok).slice(0, 5).map((row) => row.error),
        persisted,
      };
    }));
  } else {
    console.log(JSON.stringify({ ok: true, at: new Date().toISOString(), step: "audio visual ffprobe", skipped: true, reason: "REELS_BRAIN_ENABLE_AV_PROBE=false or limit=0" }));
  }

  results.push(await runStep("viewing intelligence report", () => request(
    `/api/factory/reels-brain/viewing-intelligence?niches=${encodeURIComponent(niches)}&platforms=${encodeURIComponent(platforms)}&limit_per_niche=${mediaResolveLimit}`,
    { method: "GET", timeoutMs: 60_000 },
  )));

  results.push(await runStep("analyze stored backlog", () => request("/api/factory/jobs/reels-brain-analyze-backlog", {
    method: "POST",
    timeoutMs: 125_000,
    body: JSON.stringify({
      niches,
      platforms,
      max_lanes: maxLanes,
      limit: analyzeLimit,
      build_patterns: buildPatterns,
    }),
  })));

  results.push(await runStep("rebuild pattern memory", () => request("/api/factory/reels-brain/patterns/build-all", {
    method: "POST",
    timeoutMs: 125_000,
    body: JSON.stringify({
      niches,
      limit: patternLimit,
      max_corpus_rows: 20000,
    }),
  })));

  results.push(await runStep("refresh portfolio digest", () => request(
    `/api/factory/reels-brain/digest-all?niches=${encodeURIComponent(niches)}`,
    { method: "GET", timeoutMs: 45_000 },
  )));

  const ok = results.every((row) => row.ok);
  await safeHeartbeat(ok ? "working" : "blocked", ok ? "cycle finished; waiting next tick" : "cycle finished with recoverable errors", {
    note: compact({ cycle_started: cycleStarted, results: results.map((r) => ({ name: r.name, ok: r.ok, duration_sec: r.duration_sec, error: r.error || null })) }, 900),
  });
  return { ok, cycle_started: cycleStarted, results };
}

console.log(JSON.stringify({
  ok: true,
  at: new Date().toISOString(),
  worker: workerId,
  base_url: baseUrl,
  niches,
  platforms,
  loop_every_sec: loopEverySec,
  analyze_limit: analyzeLimit,
  max_lanes: maxLanes,
  pattern_limit: patternLimit,
  media_resolve_limit: mediaResolveLimit,
  enable_media_resolver: enableMediaResolver,
  media_resolver_limit: mediaResolverLimit,
  media_resolver_poll_sec: mediaResolverPollSec,
  enable_av_probe: enableAvProbe,
  av_probe_limit: avProbeLimit,
  enable_bulk: enableBulk,
  build_patterns: buildPatterns,
}, null, 2));

if (once) {
  const result = await runCycle();
  process.exit(result.ok ? 0 : 1);
}

while (true) {
  await runCycle().catch(async (error) => {
    const message = String(error?.message || error).slice(0, 800);
    console.error(JSON.stringify({ ok: false, at: new Date().toISOString(), error: message }, null, 2));
    await safeHeartbeat("blocked", "cycle crashed; worker will retry", { blocker: message });
  });
  await sleep(loopEverySec * 1000);
}
