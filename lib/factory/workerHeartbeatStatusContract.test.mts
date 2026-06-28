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

const heartbeat = readFileSync("lib/factory/workerHeartbeat.mjs", "utf8");

ok(/function normalizeWorkerStatus\(value\)/.test(heartbeat), "worker heartbeat sender defines status normalization");
ok(/text === \"doing\" \|\| text === \"working\" \|\| text === \"running\"/.test(heartbeat), "worker heartbeat maps doing/running to working");
ok(/text === \"todo\" \|\| text === \"idle\" \|\| text === \"queued\"/.test(heartbeat), "worker heartbeat maps todo/queued to idle");
ok(/status: normalizeWorkerStatus\(/.test(heartbeat), "worker heartbeat payload uses normalized status");

if (failed) process.exit(1);
console.log(`workerHeartbeatStatusContract: ${passed} passed, ${failed} failed`);
