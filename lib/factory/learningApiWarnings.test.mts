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
ok(/select\("recipe_id,article,status,otk_score,tool,engine,node_type,attempt,variant_idx,reason,niche,output_url,source,created_at"\)/.test(learning), "learning history query includes lineage fields");
ok(/safe\("node_templates"/.test(learning), "node_templates block is labeled");
ok(/safe\("content_assets winners"/.test(learning), "winners block is labeled");
ok(/const recent_generations = \(gh as Row\[\]\)\.slice\(0, 24\)\.map\(\(r\) => \(\{[\s\S]*recipe_id: r\.recipe_id,[\s\S]*attempt: r\.attempt,[\s\S]*variant_idx: r\.variant_idx,[\s\S]*reason: r\.reason/.test(learning), "learning recent_generations keeps lineage metadata for the studio");
ok(/NextResponse\.json\(\{ ok: true,[\s\S]*warnings,[\s\S]*otk_trend/.test(learning), "learning API returns warnings without failing the route");

if (failed) process.exit(1);
console.log(`learningApiWarnings: ${passed} passed, ${failed} failed`);
