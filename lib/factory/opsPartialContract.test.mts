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

const opsRoute = readFileSync("app/api/factory/ops/route.ts", "utf8");

ok(/const warnings: string\[\] = \[\];/.test(opsRoute), "ops route accumulates partial-read warnings");
ok(/collectBalances\(db, \{ persist: true, throttleMs: BALANCE_THROTTLE_MS \}\)\.catch/.test(opsRoute), "ops route fail-opens balances read");
ok(/loadObservabilitySnapshot\(db, 48\)\.catch/.test(opsRoute), "ops route fail-opens observability read");
ok(/loadObserverPulse\(db\)\.catch/.test(opsRoute), "ops route fail-opens observer pulse read");
ok(/warnings,/.test(opsRoute), "ops route exposes warnings in success payload");

if (failed) process.exit(1);
console.log(`opsPartialContract: ${passed} passed, ${failed} failed`);
