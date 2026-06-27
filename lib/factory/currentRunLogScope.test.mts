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

const observability = readFileSync("lib/factory/observability.ts", "utf8");
const studio = readFileSync("app/api/factory/studio/route.ts", "utf8");
const graphRunRoute = readFileSync("app/api/factory/graph-run/route.ts", "utf8");

ok(/export function currentRunLog\(plan: RunPlanLike \| null \| undefined\): LogEntry\[]/.test(observability), "observability exposes currentRunLog helper");
ok(/const currentRunId = plan\?\.run_id \? String\(plan\.run_id\) : ""/.test(observability), "currentRunLog scopes by current plan run_id when available");
ok(/const scoped = log\.filter\(\(entry\) => entry && String\(entry\.run_id \|\| ""\) === currentRunId\)/.test(observability), "currentRunLog filters execution log entries by matching run_id");
ok(/const executionLog = currentRunLog\(plan\);\s*return NextResponse\.json\(\{ ok: true,[\s\S]*execution_log: executionLog/.test(graphRunRoute), "graph-run GET returns only current-run execution log");
ok(/const currentLog = currentRunLog\(plan\);[\s\S]*execution_log_count: currentLog\.length/.test(studio), "studio recipe summary counts only current-run execution steps");

if (failed) process.exit(1);
console.log(`currentRunLogScope: ${passed} passed, ${failed} failed`);
