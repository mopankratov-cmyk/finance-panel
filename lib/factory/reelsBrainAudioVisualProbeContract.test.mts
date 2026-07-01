import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const dockerfile = readFileSync("Dockerfile", "utf8");
const worker = readFileSync("lib/factory/reelsBrainRailwayWorker.mjs", "utf8");
const route = readFileSync("app/api/factory/reels-brain/audio-visual/probe/route.ts", "utf8");
const signRoute = readFileSync("app/api/factory/reels-brain/media-assets/sign/route.ts", "utf8");

ok(dockerfile.includes("apk add --no-cache ffmpeg"), "Railway image installs ffmpeg for ffprobe");
ok(worker.includes("ffprobe"), "worker runs ffprobe");
ok(worker.includes("ffprobe_missing"), "worker does not persist transient failures when ffprobe is missing");
ok(worker.includes("REELS_BRAIN_AV_PROBE_LIMIT"), "worker exposes a safe AV probe limit");
ok(worker.includes("signedAssetUrl"), "worker signs private Apify asset downloads for ffprobe");
ok(worker.includes("/api/factory/reels-brain/media-assets/sign"), "worker can request signed asset URLs from production API");
ok(worker.includes("error_samples"), "worker logs probe failure samples");
ok(worker.includes("process.env.APIFY_TOKEN"), "worker uses APIFY_TOKEN only at download time");
ok(worker.includes("mediaResolverQueryForNiche"), "worker chooses media resolver queries per niche");
ok(worker.includes("apify_async_media_resolver_balanced"), "worker balances Apify media resolving across niches");
ok(worker.includes("!row?.media_probe"), "worker avoids repeatedly probing already probed assets");
ok(worker.includes("/api/factory/reels-brain/audio-visual/probe"), "worker persists probe results through protected API");
ok(route.includes("isAuthorizedReelsBrainJobRequest"), "probe route requires job authorization");
ok(route.includes("media_probe"), "probe route stores media_probe in analyzed_full");
ok(route.includes("media_assets: root.media_assets"), "probe route preserves media_assets");
ok(!route.includes("from(\"content_assets\")"), "probe route stays inside Reels Brain corpus");
ok(route.includes("clear_transient_errors"), "probe route can clear transient local ffprobe failures");
ok(route.includes("spawn ffprobe ENOENT"), "probe cleanup targets local missing-ffprobe pollution");
ok(signRoute.includes("isAuthorizedReelsBrainJobRequest"), "sign route requires job authorization");
ok(signRoute.includes("APIFY_TOKEN"), "sign route uses the server-side Apify token");
ok(signRoute.includes("key-value-stores"), "sign route only signs Apify KV record assets");

const mediaIntelligence = readFileSync("lib/factory/reelsBrainMediaIntelligence.ts", "utf8");
ok(mediaIntelligence.includes("media_probe_ok"), "media intelligence reports successful AV probes");
ok(mediaIntelligence.includes("with_audio_stream"), "media intelligence reports audio-stream coverage");
ok(mediaIntelligence.includes("vertical_video_assets"), "media intelligence reports vertical video coverage");

console.log("reelsBrainAudioVisualProbeContract ok");
