#!/usr/bin/env node

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function hasBinary(candidate) {
  try {
    await execFileAsync(candidate, ["--version"], { timeout: 5000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function bootstrapYtDlp() {
  const home = os.homedir();
  const localBin = path.join(home, ".local/bin");
  const libraryBin = path.join(home, "Library/Python/3.14/bin");
  process.env.PATH = [localBin, libraryBin, process.env.PATH || ""].filter(Boolean).join(":");

  const candidates = [
    process.env.YT_DLP_BIN,
    "yt-dlp",
    path.join(localBin, "yt-dlp"),
    path.join(libraryBin, "yt-dlp"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await hasBinary(candidate)) {
      process.env.YT_DLP_BIN = candidate;
      return;
    }
  }
}

async function bootstrapFfmpeg() {
  const home = os.homedir();
  const localBin = path.join(home, ".local/bin");

  process.env.PATH = [
    localBin,
    "/nix/var/nix/profiles/default/bin",
    "/root/.nix-profile/bin",
    process.env.PATH || "",
  ].filter(Boolean).join(":");

  const ffmpegCandidates = [
    process.env.FFMPEG_BIN,
    "ffmpeg",
    path.join(localBin, "ffmpeg"),
    "/nix/var/nix/profiles/default/bin/ffmpeg",
    "/root/.nix-profile/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ].filter(Boolean);
  const ffprobeCandidates = [
    process.env.FFPROBE_BIN,
    "ffprobe",
    path.join(localBin, "ffprobe"),
    "/nix/var/nix/profiles/default/bin/ffprobe",
    "/root/.nix-profile/bin/ffprobe",
    "/usr/bin/ffprobe",
  ].filter(Boolean);

  for (const ffmpeg of ffmpegCandidates) {
    if (!(await hasBinary(ffmpeg))) continue;
    for (const ffprobe of ffprobeCandidates) {
      if (!(await hasBinary(ffprobe))) continue;
      process.env.FFMPEG_BIN = ffmpeg;
      process.env.FFPROBE_BIN = ffprobe;
      return;
    }
  }
}

if (!process.env.REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER) {
  process.env.REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER = "1";
}

if (!process.env.REELS_BRAIN_OFFLINE_MODE) {
  process.env.REELS_BRAIN_OFFLINE_MODE = "mixed";
}

if (!process.env.REELS_BRAIN_OFFLINE_LOOP_EVERY_SEC) {
  process.env.REELS_BRAIN_OFFLINE_LOOP_EVERY_SEC = "240";
}

if (!process.env.REELS_BRAIN_PLATFORMS) {
  // In API-first mode YouTube is metadata-only, so the offline media/audio loop
  // should focus on platforms where we can actually resolve and process media.
  process.env.REELS_BRAIN_PLATFORMS = "tiktok,instagram";
}

if (!process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_INSTAGRAM) {
  process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_INSTAGRAM = "bright_instagram";
}

if (!process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_TIKTOK) {
  process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_TIKTOK = "apify_tiktok";
}

if (!process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_YOUTUBE) {
  process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_YOUTUBE = "youtube";
}

if (!process.env.REELS_BRAIN_AUDIO_BACKFILL_LIMIT) {
  process.env.REELS_BRAIN_AUDIO_BACKFILL_LIMIT = "2";
}

if (!process.env.REELS_BRAIN_AUDIO_BACKFILL_SCAN) {
  process.env.REELS_BRAIN_AUDIO_BACKFILL_SCAN = "18";
}

if (!process.env.WORKER_ID) {
  process.env.WORKER_ID = "reels-brain-mixed-worker";
}

if (!process.env.WORKER_LABEL) {
  process.env.WORKER_LABEL = "Reels Brain Mixed Worker";
}

if (!process.env.WORKER_TASK_ID) {
  process.env.WORKER_TASK_ID = "RB-MIXED-001";
}

if (!process.env.WORKER_TASK_TITLE) {
  process.env.WORKER_TASK_TITLE = "Media and audio backfill loop";
}

console.info(JSON.stringify({
  ok: true,
  stage: "bootstrap_start",
  worker: "reels-brain-audio-railway-shim",
  offline_mode: process.env.REELS_BRAIN_OFFLINE_MODE,
  loop_every_sec: process.env.REELS_BRAIN_OFFLINE_LOOP_EVERY_SEC,
  platforms: process.env.REELS_BRAIN_PLATFORMS,
}));

await bootstrapYtDlp();
await bootstrapFfmpeg();

console.info(JSON.stringify({
  ok: true,
  stage: "bootstrap_ready",
  worker: "reels-brain-audio-railway-shim",
  yt_dlp_bin: process.env.YT_DLP_BIN || null,
  ffmpeg_bin: process.env.FFMPEG_BIN || null,
  ffprobe_bin: process.env.FFPROBE_BIN || null,
  fal_key_present: Boolean(process.env.FAL_KEY || process.env.FAL_BILLING_KEY),
}));

await import("./reelsBrainOfflineWorker.mjs");
