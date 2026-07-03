#!/usr/bin/env node

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const NIX_BIN_DIRS = [
  "/etc/profiles/per-user/root/bin",
  "/etc/profiles/per-user/app/bin",
  "/nix/var/nix/profiles/default/bin",
  "/nix/var/nix/profiles/per-user/root/profile/bin",
  "/root/.nix-profile/bin",
  "/run/current-system/sw/bin",
];

async function hasBinary(candidate, args = ["--version"]) {
  try {
    await execFileAsync(candidate, args, { timeout: 5000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function collectBinaryDiagnostics() {
  try {
    const script = `
      printf 'PATH=%s\n' "$PATH"
      printf 'whoami=%s\n' "$(whoami 2>/dev/null || true)"
      for bin in ffprobe ffmpeg yt-dlp; do
        printf 'which:%s=%s\n' "$bin" "$(command -v "$bin" 2>/dev/null || true)"
      done
      for dir in ${NIX_BIN_DIRS.map((dir) => `'${dir}'`).join(" ")}; do
        if [ -d "$dir" ]; then
          printf 'dir:%s=' "$dir"
          ls "$dir" 2>/dev/null | grep -E '^(ffmpeg|ffprobe|yt-dlp)$' | tr '\n' ',' || true
          printf '\n'
        fi
      done
    `;
    const { stdout, stderr } = await execFileAsync("sh", ["-lc", script], { timeout: 10_000, maxBuffer: 512 * 1024 });
    return {
      stdout: String(stdout || "").trim() || null,
      stderr: String(stderr || "").trim() || null,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
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
    ...NIX_BIN_DIRS,
    process.env.PATH || "",
  ].filter(Boolean).join(":");

  const ffmpegCandidates = [
    process.env.FFMPEG_BIN,
    "ffmpeg",
    path.join(localBin, "ffmpeg"),
    ...NIX_BIN_DIRS.map((dir) => path.join(dir, "ffmpeg")),
    "/usr/bin/ffmpeg",
  ].filter(Boolean);
  const ffprobeCandidates = [
    process.env.FFPROBE_BIN,
    "ffprobe",
    path.join(localBin, "ffprobe"),
    ...NIX_BIN_DIRS.map((dir) => path.join(dir, "ffprobe")),
    "/usr/bin/ffprobe",
  ].filter(Boolean);

  for (const ffmpeg of ffmpegCandidates) {
    if (!(await hasBinary(ffmpeg, ["-version"]))) continue;
    for (const ffprobe of ffprobeCandidates) {
      if (!(await hasBinary(ffprobe, ["-version"]))) continue;
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

let binaryDiagnostics = null;
if (!process.env.FFMPEG_BIN || !process.env.FFPROBE_BIN) {
  binaryDiagnostics = await collectBinaryDiagnostics();
}

console.info(JSON.stringify({
  ok: true,
  stage: "bootstrap_ready",
  worker: "reels-brain-audio-railway-shim",
  yt_dlp_bin: process.env.YT_DLP_BIN || null,
  ffmpeg_bin: process.env.FFMPEG_BIN || null,
  ffprobe_bin: process.env.FFPROBE_BIN || null,
  fal_key_present: Boolean(process.env.FAL_KEY || process.env.FAL_BILLING_KEY),
  binary_diagnostics: binaryDiagnostics,
}));

await import("./reelsBrainOfflineWorker.mjs");
