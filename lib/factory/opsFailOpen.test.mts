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

if (failed) process.exit(1);
console.log(`opsFailOpen: ${passed} passed, ${failed} failed`);
