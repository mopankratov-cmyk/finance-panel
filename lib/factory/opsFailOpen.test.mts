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

const workerState = readFileSync("app/api/factory/worker-state/route.ts", "utf8");
const ops = readFileSync("app/api/factory/ops/route.ts", "utf8");
const stability = readFileSync("app/api/factory/stability/route.ts", "utf8");

ok(/catch \(e\) \{[\s\S]*readLatestStressArtifact\(\)\.catch[\s\S]*latest_stress:\s*latestStress/.test(workerState), "worker-state crash path preserves latest stress artifact");
ok(/catch \(e\) \{[\s\S]*readStressHistorySummary\(\)\.catch[\s\S]*stress_history:\s*stressHistory/.test(workerState), "worker-state crash path preserves stress history");
ok(/catch \(e\) \{[\s\S]*readLatestStressArtifact\(\)\.catch[\s\S]*latest_stress:\s*latestStress/.test(ops), "ops crash path preserves latest stress artifact");
ok(/catch \(e\) \{[\s\S]*readStressHistorySummary\(\)\.catch[\s\S]*stress_history:\s*stressHistory/.test(ops), "ops crash path preserves stress history");
ok(/catch \(e\) \{[\s\S]*readStressHistorySummary\(\)\.catch[\s\S]*stress_history:\s*stressHistory/.test(stability), "stability crash path preserves stress history");
ok(/alerts\.push\(\{ level: "warn", code, detail: input\.workerDbError \|\| "снимок завода собран из резервного источника" \}\)/.test(ops), "optional pulse table is warning-only");
ok(!/action: "apply_worker_state_table"/.test(ops), "ops no longer presents optional heartbeat table as a P0 action");
ok(/action: "enable_optional_worker_heartbeat"/.test(ops), "ops recommends enabling optional heartbeat without blocking MVP execution");
ok(/input\.workerIssue === "table_missing"[\s\S]*elevate\("degraded"\)[\s\S]*таблица пульса не поднята/.test(ops), "missing optional heartbeat table degrades ops status instead of making it critical");
ok(/input\.workerIssue === "table_missing"[\s\S]*reasons\.push\("таблица пульса не поднята"\)/.test(ops), "ops status summary uses operator-facing pulse language");
ok(/code: "stale_running_runs"/.test(ops) && /action: "inspect_stuck_runs"/.test(ops), "ops surfaces stale running runs as a separate operational issue");
ok(/input\.staleRunning > 0[\s\S]*reasons\.push\(`подвисших прогонов: \$\{input\.staleRunning\}`\)/.test(ops), "stale running runs degrade ops summary instead of hiding under generic running");
ok(/loadObservabilitySnapshot\(db, 48\)\.then\(\(value\) => \(\{ \.\.\.value, warning: null as string \| null \}\)\)\.catch/.test(ops) && /code: "observability_partial"/.test(ops), "ops keeps worker view alive when observability snapshot degrades");
ok(/reason: `подвисших прогонов: \$\{input\.staleRunning\}`/.test(ops) && /reason: `сбоев в текущей выборке: \$\{input\.failedRuns\}`/.test(ops), "suggested action reasons are localized before Studio renders them");

if (failed) process.exit(1);
console.log(`opsFailOpen: ${passed} passed, ${failed} failed`);
