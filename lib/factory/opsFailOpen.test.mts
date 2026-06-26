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
ok(/catch \(e\) \{[\s\S]*ok: true,[\s\S]*partial: true,[\s\S]*observability: EMPTY_OBSERVABILITY[\s\S]*ops_status: \{ level: "degraded"/.test(ops), "ops crash path stays HTTP-success with degraded fallback payload");
ok(!/ops_crash[\s\S]*status:\s*500/.test(ops), "ops crash path no longer returns HTTP 500");
ok(/catch \(e\) \{[\s\S]*readStressHistorySummary\(\)\.catch[\s\S]*stress_history:\s*stressHistory/.test(stability), "stability crash path preserves stress history");
ok(/Supabase не настроен — DB-снимок стабильности временно пустой/.test(stability), "stability missing-db path is warning-only");
ok(!/снимок стабильности упал[\s\S]*status:\s*500/.test(stability), "stability crash path no longer returns HTTP 500");
ok(/alerts\.push\(\{ level: "warn", code, detail: input\.workerDbError \|\| "снимок завода собран из резервного источника" \}\)/.test(ops), "optional pulse table is warning-only");
ok(!/action: "apply_worker_state_table"/.test(ops), "ops no longer presents optional heartbeat table as a P0 action");
ok(/action: "enable_optional_worker_heartbeat"/.test(ops), "ops recommends enabling optional heartbeat without blocking MVP execution");
ok(/if \(input\.workerIssue === "table_missing"\) \{\s*reasons\.push\("пульс через резерв"\);\s*\} else \{\s*elevate\("degraded"\)/.test(ops), "missing optional heartbeat table stays informational and does not degrade factory status");
ok(/input\.workerIssue === "table_missing"[\s\S]*пульс через резерв/.test(ops), "ops status summary uses operator-facing reserve pulse language");
ok(/function enrichFallbackWorkerFromObserver[\s\S]*worker\.source !== "queue_fallback" \|\| worker\.last_seen[\s\S]*heartbeat\?\.last_activity_at[\s\S]*liveness\(lastSeen\)/.test(ops), "ops enriches queue fallback worker with observer pulse before classifying liveness");
ok(/code: "stale_running_runs"/.test(ops) && /action: "inspect_stuck_runs"/.test(ops), "ops surfaces stale running runs as a separate operational issue");
ok(/input\.staleRunning > 0[\s\S]*reasons\.push\(`подвисших прогонов: \$\{input\.staleRunning\}`\)/.test(ops), "stale running runs degrade ops summary instead of hiding under generic running");
ok(/loadObservabilitySnapshot\(db, 48\)\.then\(\(value\) => \(\{ \.\.\.value, warning: null as string \| null \}\)\)\.catch/.test(ops) && /code: "observability_partial"/.test(ops), "ops keeps worker view alive when observability snapshot degrades");
ok(/reason: `подвисших прогонов: \$\{input\.staleRunning\}`/.test(ops) && /reason: `сбоев в текущей выборке: \$\{input\.failedRuns\}`/.test(ops), "suggested action reasons are localized before Studio renders them");

if (failed) process.exit(1);
console.log(`opsFailOpen: ${passed} passed, ${failed} failed`);
