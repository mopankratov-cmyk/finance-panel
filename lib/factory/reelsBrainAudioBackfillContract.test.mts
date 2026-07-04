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

if (failed) process.exit(1);
console.log(`reelsBrainAudioBackfillContract: ${passed} passed, ${failed} failed`);
