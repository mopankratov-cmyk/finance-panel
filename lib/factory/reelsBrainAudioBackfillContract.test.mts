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
ok(/whisper_empty_text/.test(resolver) && /transcript_no_speech/.test(resolver), "media resolver treats empty whisper results as terminal");
ok(/shouldRetryTranscriptExtraction/.test(route), "audio backfill route uses transcript retry helper");
ok(/transcriptError:\s*state\.audioFeatures\?\.transcript_error/.test(route), "audio backfill route consults stored transcript error");

if (failed) process.exit(1);
console.log(`reelsBrainAudioBackfillContract: ${passed} passed, ${failed} failed`);
