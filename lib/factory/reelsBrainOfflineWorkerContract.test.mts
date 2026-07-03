import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function ok(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL", msg);
  }
}

const worker = readFileSync("lib/factory/reelsBrainOfflineWorker.mjs", "utf8");

ok(/reels-brain-media-backfill/.test(worker), "offline worker targets media-backfill route");
ok(/reels-brain-audio-backfill/.test(worker), "offline worker supports audio-backfill route");
ok(/reels-brain-media-commit/.test(worker), "offline worker persists local resolver results");
ok(/reels-brain-audio-commit/.test(worker), "offline worker persists local audio extraction results");
ok(/use_local_resolver/.test(worker), "offline worker forwards local resolver flag");
ok(/dry_run/.test(worker), "offline worker can request dry-run audio candidates from API");
ok(/worker-state/.test(worker), "offline worker can send worker-state heartbeat");
ok(/controller\.abort\(\)/.test(worker) && /signal:\s*controller\.signal/.test(worker), "offline worker fetchJson uses abort controller timeout");
ok(/REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER/.test(worker), "offline worker reads local media resolver env");
ok(/REELS_BRAIN_AUDIO_LOCAL/.test(worker), "offline worker reads local audio extraction env");
ok(/REELS_BRAIN_QUEUE_PRIORITY/.test(worker), "offline worker reads queue priority env");
ok(/REELS_BRAIN_WORKER_SHARD_INDEX/.test(worker) && /REELS_BRAIN_WORKER_SHARD_COUNT/.test(worker), "offline worker reads shard env");
ok(/REELS_BRAIN_DEEP_ONLY/.test(worker), "offline worker reads deep-only env");
ok(/function shouldUseYtDlpCookies/.test(worker), "offline worker scopes yt-dlp cookies by target domain");
ok(/youtube\\.com\\|youtu\\.be/.test(worker), "offline worker only applies yt-dlp cookies to YouTube domains");
ok(/function finalizeTranscriptOutcome/.test(worker), "offline worker normalizes transcript outcomes");
ok(/transcript_no_speech/.test(worker), "offline worker marks empty whisper responses as no-speech terminal state");
ok(/remoteFallback = await transcribeFal/.test(worker), "offline worker retries local empty transcript via remote media fallback");
ok(
  /REELS_BRAIN_OFFLINE_MODE/.test(worker)
    && /mode === "audio"/.test(worker)
    && /mode === "media"/.test(worker),
  "offline worker supports media/audio modes",
);
ok(/cycle % 2 === 1 \? "media" : "audio"/.test(worker), "offline worker supports mixed mode alternating media/audio cycles");
ok(
  /REELS_BRAIN_PLATFORMS/.test(worker)
    && /Math\.floor\(\(cycle - 1\) \/ 2\) % config\.platforms\.length/.test(worker)
    && /platforms\[platformIndex\]/.test(worker),
  "offline worker rotates across configured platforms in media+audio pairs",
);
ok(/shard_index/.test(worker) && /shard_count/.test(worker), "offline worker forwards shard routing to queue routes");
ok(/deep_only/.test(worker), "offline worker forwards deep-only routing to queue routes");
ok(/while \(true\)/.test(worker) && /await runCycle\(config, cycle\)/.test(worker), "offline worker supports daemon loop");

if (failed) process.exit(1);
console.log(`reelsBrainOfflineWorkerContract: ${passed} passed, ${failed} failed`);
