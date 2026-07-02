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

  try {
    await execFileAsync(
      "python3",
      ["-m", "pip", "install", "--user", "yt-dlp"],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env: process.env },
    );
  } catch {}

  for (const candidate of [
    "yt-dlp",
    path.join(localBin, "yt-dlp"),
    path.join(libraryBin, "yt-dlp"),
  ]) {
    if (await hasBinary(candidate)) {
      process.env.YT_DLP_BIN = candidate;
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
  process.env.REELS_BRAIN_PLATFORMS = "tiktok,instagram,youtube";
}

if (!process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_INSTAGRAM) {
  process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_INSTAGRAM = "bright_instagram";
}

if (!process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_TIKTOK) {
  process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_TIKTOK = "apify_tiktok";
}

if (!process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_YOUTUBE) {
  process.env.REELS_BRAIN_MEDIA_BACKFILL_PROVIDER_YOUTUBE = "apify_youtube";
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

await bootstrapYtDlp();
await import("./reelsBrainOfflineWorker.mjs");
