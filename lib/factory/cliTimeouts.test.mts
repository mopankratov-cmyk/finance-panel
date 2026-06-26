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

const stress = readFileSync("lib/factory/stressGraphRun.mjs", "utf8");
const heartbeat = readFileSync("lib/factory/workerHeartbeat.mjs", "utf8");

ok(/FACTORY_STRESS_REQUEST_TIMEOUT_MS/.test(stress), "stress runner exposes request timeout env");
ok(/FACTORY_STRESS_REQUEST_RETRIES/.test(stress) && /request-retries/.test(stress), "stress runner exposes request retry controls");
ok(/RUN_START/.test(stress), "stress runner prints progress before each run");
ok(/FACTORY_STRESS_MAX_POLLS \|\| 300/.test(stress), "stress runner default run deadline is long enough for production Remotion plus cron wake path");
ok(/Number\.isFinite\(requestTimeoutRaw\)[\s\S]*Math\.max\(5_000, requestTimeoutRaw\)[\s\S]*45_000/.test(stress), "stress runner clamps invalid request timeout config");
ok(/controller\.abort\(\)/.test(stress) && /signal:\s*controller\.signal/.test(stress), "stress runner fetchJson uses AbortController signal");
ok(/catch \(err\) \{[\s\S]*status:\s*authFailure \? "auth_fail" : "run_fail"[\s\S]*step:\s*authFailure \? "blocked" : "failed"/.test(stress), "stress runner records per-run request failures in report output");
ok(/signal:\s*AbortSignal\.timeout\(15_000\)/.test(heartbeat), "worker heartbeat POST has a hard timeout");
ok(/while \(true\) \{[\s\S]*try \{[\s\S]*await postHeartbeat\(\);/.test(heartbeat), "worker heartbeat daemon survives transient POST failures");

if (failed) process.exit(1);
console.log(`cliTimeouts: ${passed} passed, ${failed} failed`);
