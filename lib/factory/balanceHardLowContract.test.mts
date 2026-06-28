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

const source = readFileSync("lib/factory/balances.ts", "utf8");

ok(/function isHardLowBalance\(service: string, balance: number \| null\): boolean/.test(source), "balances has hard low helper");
ok(/\["fal", "creatify", "virlo"\]\.includes\(service\) && balance <= 0/.test(source), "paid API balances at zero or below are always low");
ok(/const low = isHardLowBalance\(m\.service, balance\) \|\| \(balance != null && threshold != null && balance <= threshold\);/.test(source), "threshold low keeps hard-low fallback");
ok(/function apiBalanceTimeoutMs\(service: string\): number/.test(source), "balances has per-service API timeout");
ok(/return service === "fal" \? 20_000 : 9_000;/.test(source), "FAL billing gets a longer timeout than other balance APIs");

if (failed) process.exit(1);
console.log(`balanceHardLowContract: ${passed} passed, ${failed} failed`);
