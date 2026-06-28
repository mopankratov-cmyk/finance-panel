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

const html = readFileSync("public/inferno/patrick-legacy.html", "utf8");

ok(/run:\s*\{ busy: false, step: '', ideas: \[\], approved: 0, err: '', batchPlan: null \}/.test(html), "patrick legacy keeps batch plan in run state");
ok(/this\.run\.batchPlan = d\.batch_plan \|\| null;/.test(html), "patrick legacy stores batch plan from scripts response");
ok(/План следующей пятёрки/.test(html), "patrick legacy renders batch plan card");
ok(/s\.batch_role==='control'/.test(html), "patrick legacy marks control ideas");
ok(/s\.batch_role==='experiment'/.test(html), "patrick legacy marks experiment ideas");
ok(/s\.change_axis/.test(html), "patrick legacy shows change axis");
ok(/batch_role: s\.batch_role \|\| null/.test(html), "patrick legacy persists batch role into bank items");
ok(/change_axis: s\.change_axis \|\| null/.test(html), "patrick legacy persists change axis into bank items");

if (failed) process.exit(1);
console.log(`patrickBatchPlanContract: ${passed} passed, ${failed} failed`);
