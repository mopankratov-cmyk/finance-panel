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

const source = readFileSync("app/api/factory/gen-save/route.ts", "utf8");

ok(/batch_role: b\.batch_role \|\| null/.test(source), "gen-save stores batch role in asset analysis");
ok(/change_axis: b\.change_axis \|\| null/.test(source), "gen-save stores change axis in asset analysis");

if (failed) process.exit(1);
console.log(`genSaveBatchMetaContract: ${passed} passed, ${failed} failed`);
