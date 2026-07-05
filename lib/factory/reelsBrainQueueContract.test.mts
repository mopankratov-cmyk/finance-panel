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

const queue = readFileSync("lib/factory/reelsBrainQueue.ts", "utf8");
const mediaRoute = readFileSync("app/api/factory/jobs/reels-brain-media-backfill/route.ts", "utf8");
const analyzeRoute = readFileSync("app/api/factory/jobs/reels-brain-analyze-backlog/route.ts", "utf8");

ok(/export function parseShardConfig/.test(queue), "queue helper exposes shard config parser");
ok(/export function stableShardMatch/.test(queue), "queue helper exposes numeric shard matcher");
ok(/export function stableBucketMatch/.test(queue), "queue helper exposes string bucket shard matcher");
ok(/export function scoreAudioCandidate/.test(queue) && /export function scoreMediaCandidate/.test(queue), "queue helper exposes priority scoring helpers");
ok(/parseShardConfig/.test(mediaRoute) && /stableShardMatch/.test(mediaRoute), "media backfill route supports sharded workers");
ok(/scoreMediaCandidate/.test(mediaRoute) && /priority/.test(mediaRoute), "media backfill route supports smart priority ordering");
ok(/focus_niche/.test(mediaRoute) && /focus_platform/.test(mediaRoute) && /source_discovery_mode/.test(mediaRoute), "media backfill route accepts focused exact-proof context");
ok(/parseShardConfig/.test(analyzeRoute) && /stableBucketMatch/.test(analyzeRoute), "analyze backlog route supports sharded lanes");

if (failed) process.exit(1);
console.log(`reelsBrainQueueContract: ${passed} passed, ${failed} failed`);
