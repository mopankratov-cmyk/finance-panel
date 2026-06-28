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

const learning = readFileSync("app/api/factory/learning/route.ts", "utf8");

ok(/const warnings: string\[\] = \[\]/.test(learning), "learning API collects warning context");
ok(/const safe = async \(label: string, fn: \(\) => Promise<any>, fallback: any\)/.test(learning), "learning safe helper is label-aware");
ok(/warnings\.push\(`\$\{label\}: \$\{String/.test(learning), "learning safe helper records query degradation");
ok(/safe\("cf_signals"/.test(learning), "cf_signals block is labeled");
ok((learning.match(/const \{ data, error \} = await q;/g) || []).length >= 5, "learning queries capture Supabase error objects");
ok((learning.match(/if \(error\) throw error;/g) || []).length >= 5, "learning queries surface Supabase errors");
ok(/safe\("viral_hooks"/.test(learning), "viral_hooks block is labeled");
ok(/safe\("generation_history"/.test(learning), "generation_history block is labeled");
ok(/safe\("node_templates"/.test(learning), "node_templates block is labeled");
ok(/safe\("content_assets winners"/.test(learning), "winners block is labeled");
ok(/safe\("improvement loop"/.test(learning), "improvement loop block is labeled");
ok(/winners,\s*improvement/.test(learning), "learning API returns improvement snapshot");
ok(/batch_plan: null/.test(learning), "learning API improvement fallback includes batch plan");
ok(/axis_insights: \[\]/.test(learning), "learning API improvement fallback includes axis insights");
ok(/feedback_queue: \[\]/.test(learning), "learning API improvement fallback includes feedback queue");
ok(/series_state: \{ target_batches: 10/.test(learning), "learning API improvement fallback includes series state");
ok(/next_batch_gate: \{ ready: false/.test(learning), "learning API improvement fallback includes next-batch gate");
ok(/NextResponse\.json\(\{ ok: true,[\s\S]*warnings,[\s\S]*otk_trend/.test(learning), "learning API returns warnings without failing the route");

if (failed) process.exit(1);
console.log(`learningApiWarnings: ${passed} passed, ${failed} failed`);
