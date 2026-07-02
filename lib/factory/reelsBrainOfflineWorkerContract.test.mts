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
ok(/reels-brain-media-commit/.test(worker), "offline worker persists local resolver results");
ok(/use_local_resolver/.test(worker), "offline worker forwards local resolver flag");
ok(/worker-state/.test(worker), "offline worker can send worker-state heartbeat");
ok(/controller\.abort\(\)/.test(worker) && /signal:\s*controller\.signal/.test(worker), "offline worker fetchJson uses abort controller timeout");
ok(/REELS_BRAIN_ENABLE_LOCAL_MEDIA_RESOLVER/.test(worker), "offline worker reads local media resolver env");
ok(/while \(true\)/.test(worker) && /await runCycle\(config, cycle\)/.test(worker), "offline worker supports daemon loop");

if (failed) process.exit(1);
console.log(`reelsBrainOfflineWorkerContract: ${passed} passed, ${failed} failed`);
