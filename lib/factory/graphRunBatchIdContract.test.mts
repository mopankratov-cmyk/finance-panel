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

const types = readFileSync("lib/factory/graphTypes.ts", "utf8");
const route = readFileSync("app/api/factory/graph-run/route.ts", "utf8");
const runner = readFileSync("lib/factory/graphRun.ts", "utf8");

ok(/batch_run_id\?: string \| null;/.test(types), "RunPlan stores batch run id");
ok(/batch_role\?: "control" \| "experiment" \| "none" \| null;/.test(types), "RunPlan stores batch role");
ok(/change_axis\?: "none" \| "hook_angle" \| "proof_density" \| "cta_shape" \| "format" \| null;/.test(types), "RunPlan stores change axis");
ok(/if \(body\.batch_run_id\) plan\.batch_run_id = String\(body\.batch_run_id\)\.slice\(0, 80\);/.test(route), "graph-run persists incoming batch run id");
ok(/plan\.batch_role = String\(body\.batch_role\) as RunPlan\["batch_role"\];/.test(route), "graph-run persists incoming batch role");
ok(/plan\.change_axis = String\(body\.change_axis\) as RunPlan\["change_axis"\];/.test(route), "graph-run persists incoming change axis");
ok(/batch_run_id: plan\?\.batch_run_id \|\| null/.test(route), "graph-run status returns batch run id");
ok(/batch_role: plan\?\.batch_role \|\| null/.test(route), "graph-run status returns batch role");
ok(/change_axis: plan\?\.change_axis \|\| null/.test(route), "graph-run status returns change axis");
ok(/batch_role: plan\.batch_role \|\| null/.test(runner), "graph runner passes batch role into gen-save");
ok(/change_axis: plan\.change_axis \|\| null/.test(runner), "graph runner passes change axis into gen-save");

if (failed) process.exit(1);
console.log(`graphRunBatchIdContract: ${passed} passed, ${failed} failed`);
