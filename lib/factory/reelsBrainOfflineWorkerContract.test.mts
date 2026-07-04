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
ok(/raw == null \|\| String\(raw\)\.trim\(\) === ""/.test(worker), "offline worker timeout env parser falls back when env is unset");
ok(/REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER/.test(worker), "offline worker reads local media resolver env");
ok(/REELS_BRAIN_AUDIO_LOCAL/.test(worker), "offline worker reads local audio extraction env");
ok(/REELS_BRAIN_QUEUE_PRIORITY/.test(worker), "offline worker reads queue priority env");
ok(/REELS_BRAIN_WORKER_SHARD_INDEX/.test(worker) && /REELS_BRAIN_WORKER_SHARD_COUNT/.test(worker), "offline worker reads shard env");
ok(/REELS_BRAIN_DEEP_ONLY/.test(worker), "offline worker reads deep-only env");
ok(/function shouldUseYtDlpCookies/.test(worker), "offline worker scopes yt-dlp cookies by target domain");
ok(/youtube\\.com\\|youtu\\.be/.test(worker), "offline worker only applies yt-dlp cookies to YouTube domains");
ok(/YT_DLP_ENABLE_YOUTUBE_COOKIES/.test(worker), "offline worker makes YouTube cookies opt-in");
ok(/instagram\\.com\\|instagr\\.am/.test(worker) && /YT_DLP_ENABLE_INSTAGRAM_COOKIES/.test(worker), "offline worker can opt Instagram cookies into yt-dlp");
ok(/REELS_BRAIN_ENABLE_YOUTUBE_LOCAL_RESOLVER/.test(worker), "offline worker makes YouTube local resolver opt-in");
ok(/prependPathEntries\(NIX_BIN_DIRS\)/.test(worker) && /NIX_BIN_DIRS\.map\(\(dir\) => path\.join\(dir, "yt-dlp"\)\)/.test(worker), "offline worker searches nix yt-dlp locations before giving up");
ok(/function shouldSkipDownloadForYtDlpProbe/.test(worker) && /base\.push\("--skip-download"\)/.test(worker), "offline worker disables --skip-download for YouTube cookie-backed probes");
ok(/function ytDlpProbeArgSets/.test(worker) && /player_client=android,web/.test(worker) && /-f", "b\/best"/.test(worker), "offline worker retries YouTube probes with alternate clients and fallback format selection");
ok(/function normalizeYtDlpTarget/.test(worker) && /share_item_id/.test(worker) && /embed\/v2/.test(worker), "offline worker normalizes TikTok share urls before yt-dlp");
ok(/route_local_resolver_enabled/.test(worker), "offline worker logs route resolver state separately from worker resolver state");
ok(/function fetchLocalMediaBackfillCandidates/.test(worker), "offline worker can source media backlog candidates directly from Supabase");
ok(/stage: "local_media_candidate_fallback"/.test(worker), "offline worker logs when it falls back to local media candidate selection");
ok(/function finalizeTranscriptOutcome/.test(worker), "offline worker normalizes transcript outcomes");
ok(/transcript_no_speech/.test(worker), "offline worker marks empty whisper responses as no-speech terminal state");
ok(/remoteFallback = await transcribeFal/.test(worker), "offline worker retries local empty transcript via remote media fallback");
ok(/stage:\s*"heartbeat_failed_open"/.test(worker), "offline worker keeps cycle alive when heartbeat transport fails");
ok(/function fetchJsonViaCurl/.test(worker) && /fetch_json_curl_fallback/.test(worker), "offline worker can fall back to curl transport for retryable fetch aborts");
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
