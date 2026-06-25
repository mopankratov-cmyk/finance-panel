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

const route = readFileSync("app/api/factory/worker-state/route.ts", "utf8");

ok(/const EMPTY_OBSERVABILITY: Record<string, unknown> = \{[\s\S]*stale_running: 0/.test(route), "worker-state route has an empty observability fallback contract");
ok(/const EMPTY_OBSERVABILITY: Record<string, unknown> = \{[\s\S]*active_sample_runs: 0[\s\S]*legacy_warning_runs: 0[\s\S]*legacy_failed_runs: 0/.test(route), "worker-state fallback contract includes active-vs-legacy observability fields");
ok(/loadObservabilitySnapshot\(db, 30\)\.then\(\(value\) => \(\{ \.\.\.value, warning: null as string \| null \}\)\)\.catch/.test(route), "worker-state keeps serving when node_recipes snapshot degrades");
ok(/observability_warning: observabilitySnapshot\.warning/.test(route), "worker-state exposes snapshot degradation as metadata instead of crashing");

if (failed) process.exit(1);
console.log(`workerStateFailOpen: ${passed} passed, ${failed} failed`);
