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

ok(/summary\.targetMet = summary\.completed === summary\.totalRuns && !summary\.failed && !summary\.runFail && !summary\.timeouts && !summary\.authFailures/.test(stress), "stress target is computed from the current stress run");
ok(/stress_target_met: \$\{stressTargetMet \? "yes" : "no"\}/.test(stress), "markdown report exposes current stress target result");
ok(/auth_fail: \$\{summary\.authFailures \|\| 0\}/.test(stress), "markdown report separates auth failures from factory run failures");
ok(/status: authFailure \? "auth_fail" : "run_fail"/.test(stress), "stress runner separates authorization failures from graph-run failures");
ok(/const maxWaitSec = Math\.round\(\(pollMs \* maxPolls\) \/ 1000\)/.test(stress) && /timeout_budget_sec: \$\{summary\.timeoutBudgetSec \|\| 0\}/.test(stress), "stress report exposes the timeout budget");
ok(/status: "timeout"/.test(stress) && /lastStatus: last\?\.status \|\| null/.test(stress) && /error: `timeout waiting for completion after \$\{maxWaitSec\}s`/.test(stress), "stress runner marks deadline exits as timeout instead of last live run status");
ok(/## DB Stability Snapshot/.test(stress), "database-wide stability block is clearly labeled");
ok(/database-wide recent-runs snapshot/.test(stress), "markdown explains DB snapshot can include older failures");
ok(/db_target_met: \$\{stability\.target_met \? "yes" : "no"\}/.test(stress), "DB target is separated from stress target");

if (failed) process.exit(1);
console.log(`stressReportContract: ${passed} passed, ${failed} failed`);
