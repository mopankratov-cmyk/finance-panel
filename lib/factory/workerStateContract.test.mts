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
const workerStateLib = readFileSync("lib/factory/workerState.ts", "utf8");

ok(/classifyWorkerHeartbeatIssue/.test(workerStateRoute), "worker-state route imports heartbeat issue classifier");
ok(/normalizeWorkerStatus/.test(workerStateRoute), "worker-state route imports worker status normalization");
ok(/heartbeat_diagnostics:\s*heartbeatDiagnostics/.test(workerStateRoute), "worker-state route exposes heartbeat_diagnostics");
ok(/worker_issue:\s*workerIssue/.test(workerStateRoute), "worker-state route exposes worker_issue");
ok(/db_error:\s*dbError/.test(workerStateRoute), "worker-state crash path keeps normalized db_error");
ok(/db_error:\s*"Supabase is not configured"/.test(workerStateRoute), "worker-state missing-db path keeps explicit db_error");
ok(/status:\s*normalizeWorkerStatus\(body\.status \|\| "idle"\)/.test(workerStateRoute), "worker-state POST normalizes incoming worker status");
ok(/export function normalizeWorkerStatus\(value: unknown\): string/.test(workerStateLib), "worker-state library defines shared worker status normalization");
ok(/status:\s*normalizeWorkerStatus\(active\.status \|\| "unknown"\)/.test(workerStateLib), "queue fallback uses normalized worker status");
ok(/status:\s*normalizeWorkerStatus\(w\.status\)/.test(workerStateLib), "db worker rows are normalized on read");

if (failed) process.exit(1);
console.log(`workerStateContract: ${passed} passed, ${failed} failed`);
