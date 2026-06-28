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

const smoke = readFileSync("lib/factory/prodSmoke.mjs", "utf8");

ok(/\/api\/factory\/ops/.test(smoke), "prod smoke checks ops endpoint");
ok(/\/api\/factory\/worker-state/.test(smoke), "prod smoke checks worker-state endpoint");
ok(/\/api\/factory\/stability/.test(smoke), "prod smoke checks stability endpoint");
ok(/\/api\/factory\/graph-run\?recipe_id=\$\{opts\.recipeId\}/.test(smoke), "prod smoke checks graph-run read endpoint");
ok(/if \(opts\.triggerRun\)/.test(smoke), "prod smoke supports optional graph-run write trigger");
ok(/return \"auth\";/.test(smoke), "prod smoke classifies auth failures");
ok(/return \"worker_infra\";/.test(smoke), "prod smoke classifies worker infra failures");
ok(/return \"observability\";/.test(smoke), "prod smoke classifies observability failures");
ok(/return \"provider\";/.test(smoke), "prod smoke classifies provider failures");
ok(/const DEFAULT_JSON_OUT = \"docs\/factory-latest-prod-smoke\.json\";/.test(smoke), "prod smoke writes latest json artifact");
ok(/const DEFAULT_MD_OUT = \"docs\/factory-latest-prod-smoke\.md\";/.test(smoke), "prod smoke writes latest markdown artifact");

if (failed) process.exit(1);
console.log(`prodSmokeContract: ${passed} passed, ${failed} failed`);
