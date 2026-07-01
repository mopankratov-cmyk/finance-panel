import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const dockerfile = readFileSync("Dockerfile", "utf8");
const worker = readFileSync("lib/factory/reelsBrainRailwayWorker.mjs", "utf8");
const route = readFileSync("app/api/factory/reels-brain/audio-visual/probe/route.ts", "utf8");

ok(dockerfile.includes("apk add --no-cache ffmpeg"), "Railway image installs ffmpeg for ffprobe");
ok(worker.includes("ffprobe"), "worker runs ffprobe");
ok(worker.includes("REELS_BRAIN_AV_PROBE_LIMIT"), "worker exposes a safe AV probe limit");
ok(worker.includes("/api/factory/reels-brain/audio-visual/probe"), "worker persists probe results through protected API");
ok(route.includes("isAuthorizedReelsBrainJobRequest"), "probe route requires job authorization");
ok(route.includes("media_probe"), "probe route stores media_probe in analyzed_full");
ok(route.includes("media_assets: root.media_assets"), "probe route preserves media_assets");
ok(!route.includes("from(\"content_assets\")"), "probe route stays inside Reels Brain corpus");

console.log("reelsBrainAudioVisualProbeContract ok");
