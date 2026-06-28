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

const source = readFileSync("app/api/factory/scripts/route.ts", "utf8");

ok(/import \{ batchPlanHintFor, improvementHintFor \} from "\@\/lib\/factory\/learningHints";/.test(source), "scripts route imports improvement and batch-plan hints");
ok(/let batchImprovementHint = ""/.test(source), "scripts route allocates batch improvement hint slot");
ok(/let batchPlanHint = ""/.test(source), "scripts route allocates batch plan hint slot");
ok(/batchImprovementHint = await improvementHintFor\(db, niche\);/.test(source), "scripts route pulls improvement hint per niche");
ok(/batchPlanHint = await batchPlanHintFor\(db, niche\);/.test(source), "scripts route pulls batch plan hint per niche");
ok(/const snapshot = await loadImprovementSnapshot\(db, \{ niche, target_runs: 50, batch_size: 5 \}\);/.test(source), "scripts route loads live improvement snapshot");
ok(/batchPlan = snapshot\.batch_plan \|\| null;/.test(source), "scripts route exposes batch plan from snapshot");
ok(/batch_role":"control\|experiment"/.test(source), "scripts response schema includes batch role");
ok(/change_axis":"none\|hook_angle\|proof_density\|cta_shape\|format"/.test(source), "scripts response schema includes change axis");
ok(/pbHint \+ winnersHint \+ corpusHookHint \+ rejHint \+ batchImprovementHint \+ batchPlanHint/.test(source), "scripts prompt includes improvement and batch plan hints");
ok(/batch_plan: batchPlan/.test(source), "scripts response returns batch plan");

if (failed) process.exit(1);
console.log(`scriptsImprovementContract: ${passed} passed, ${failed} failed`);
