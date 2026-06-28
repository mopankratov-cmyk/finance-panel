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

const source = readFileSync("lib/factory/seriesNewCyclePreflight.mjs", "utf8");

ok(/Factory new-cycle preflight \(no generation launch\)/.test(source), "new-cycle preflight states that it does not launch generation");
ok(/\/api\/factory\/series-readiness/.test(source), "new-cycle preflight checks series readiness");
ok(/\/api\/factory\/batch/.test(source), "new-cycle preflight checks batch dry run");
ok(/series_after/.test(source), "new-cycle preflight forwards active series window");
ok(/dry_run: true/.test(source), "new-cycle preflight only runs batch dry-run");
ok(/require_full_batch: true/.test(source), "new-cycle preflight requires a full five");
ok(/require_learning_gate: true/.test(source), "new-cycle preflight requires learning gate");
ok(/DEFAULT_JSON_OUT = "docs\/factory-latest-series-new-cycle-preflight\.json"/.test(source), "new-cycle preflight writes latest JSON artifact");
ok(/DEFAULT_MD_OUT = "docs\/factory-latest-series-new-cycle-preflight\.md"/.test(source), "new-cycle preflight writes latest markdown artifact");
ok(/batch\.body\?\.dry_run === true/.test(source), "new-cycle preflight verifies dry-run response");
ok(/batch\.body\?\.preflight\?\.ready === true/.test(source), "new-cycle preflight requires ready preflight");
ok(!/trigger-run/.test(source), "new-cycle preflight has no trigger-run mode");
ok(!/restart: true/.test(source), "new-cycle preflight never restarts graph-run");

if (failed) process.exit(1);
console.log(`seriesNewCyclePreflightContract: ${passed} passed, ${failed} failed`);
