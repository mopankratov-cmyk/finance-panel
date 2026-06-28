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

const workerStateRoute = readFileSync("app/api/factory/worker-state/route.ts", "utf8");

ok(/loadObservabilitySnapshot\(db, 30\)\.catch/.test(workerStateRoute), "worker-state route degrades observability readback instead of crashing the whole route");
ok(/warnings:\s*string\[\]\s*=\s*\[\]/.test(workerStateRoute), "worker-state route accumulates warnings for degraded readbacks");
ok(/warnings,/.test(workerStateRoute), "worker-state route exposes warnings in the success payload");

if (failed) process.exit(1);
console.log(`workerStateFailOpenObservability: ${passed} passed, ${failed} failed`);
