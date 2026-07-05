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

const resolver = readFileSync("lib/factory/reelsBrainMediaResolver.ts", "utf8");
const route = readFileSync("app/api/factory/jobs/reels-brain-audio-backfill/route.ts", "utf8");

ok(/export function isTerminalTranscriptError/.test(resolver), "media resolver exposes terminal transcript error helper");
ok(/export function shouldRetryTranscriptExtraction/.test(resolver), "media resolver exposes transcript retry helper");
ok(/export function isTerminalAudioError/.test(resolver), "media resolver exposes terminal audio error helper");
ok(/export function shouldRetryAudioBackfill/.test(resolver), "media resolver exposes audio backfill retry helper");
ok(/function ytDlpBin\(\)/.test(resolver) && /process\.env\.YT_DLP_BIN/.test(resolver), "media resolver respects YT_DLP_BIN from worker env");
ok(/function ffmpegBin\(\)/.test(resolver) && /process\.env\.FFMPEG_BIN/.test(resolver), "media resolver respects FFMPEG_BIN from worker env");
ok(/function ffprobeBin\(\)/.test(resolver) && /process\.env\.FFPROBE_BIN/.test(resolver), "media resolver respects FFPROBE_BIN from worker env");
ok(/async function ensureYtDlpCookiesPath/.test(resolver) && /YT_DLP_COOKIES_PATH/.test(resolver), "media resolver can materialize yt-dlp cookie file from env");
ok(/YT_DLP_COOKIES_B64/.test(resolver) && /YT_DLP_COOKIES_GZ_B64/.test(resolver) && /YT_DLP_COOKIES_TXT/.test(resolver), "media resolver supports plain, base64 and gzipped cookie payloads");
ok(/function ytDlpProbeArgSets/.test(resolver) && /youtube:player_client=android,web/.test(resolver), "media resolver retries YouTube probe with multiple player clients");
ok(/--cookies/.test(resolver) && /ensureYtDlpCookiesPath/.test(resolver), "media resolver passes cookie file to yt-dlp when cookies are enabled");
ok(/whisper_empty_text/.test(resolver) && /transcript_no_speech/.test(resolver), "media resolver treats empty whisper results as terminal");
ok(/media_fetch_403/.test(resolver) && /status code 10204/.test(resolver) && /media_locator_unresolved/.test(resolver) && /moov atom not found/.test(resolver), "media resolver treats unavailable and corrupted media locators as terminal audio errors");
ok(/shouldRetryAudioBackfill/.test(route), "audio backfill route uses audio backfill retry helper");
ok(/transcriptError:\s*state\.audioFeatures\?\.transcript_error/.test(route), "audio backfill route consults stored transcript error");
ok(/const hasPlayable = state\.mediaLocators\.some/.test(route) && !/Boolean\(String\(row\.url \|\| \"\"\)\.trim\(\)\)/.test(route), "audio backfill route only queues rows with real media locators");
ok(
  route.includes('platform === "youtube"')
  && route.includes('youtube\\.com\\/shorts\\/')
  && route.includes('platform === "instagram"')
  && route.includes('instagram\\.com|instagr\\.am'),
  "audio backfill route accepts YouTube and Instagram page locators for deep extraction",
);
ok(/parseShardConfig/.test(route) && /stableShardMatch/.test(route), "audio backfill route supports sharded worker queues");
ok(/scoreAudioCandidate/.test(route) && /priority/.test(route), "audio backfill route supports smart candidate prioritization");
ok(/deepOnly/.test(route) && /virality_score/.test(route), "audio backfill route supports deep-only gating for expensive analysis");
ok(/focus_niche/.test(route) && /focus_platform/.test(route) && /source_discovery_mode/.test(route), "audio backfill route accepts focused segment context from the learning loop");
ok(/focusMatch/.test(route) && /close_exact_proof/.test(route) && /deepFocusedRanked/.test(route), "audio backfill route prioritizes exact-proof focused rows before generic backlog");
ok(/field_focus/.test(route) && /family_focus/.test(route) && /audioFocusBonus/.test(route) && /field_focused_deep_only/.test(route), "audio backfill route accepts brief-gap focus and deepens audio/transcript extraction when the brief gap requires it");

if (failed) process.exit(1);
console.log(`reelsBrainAudioBackfillContract: ${passed} passed, ${failed} failed`);
