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

const genHistory = readFileSync("lib/factory/genHistory.ts", "utf8");
const route = readFileSync("app/api/factory/generation-history/route.ts", "utf8");

ok(/export interface GenHistoryResult \{[\s\S]*history: GenHistoryRow\[\];[\s\S]*warning\?: string;/.test(genHistory), "genHistory exposes result metadata");
ok(/summary\?: \{[\s\S]*attempts:[\s\S]*outputs:[\s\S]*best_otk:[\s\S]*last_status:[\s\S]*variant_count:[\s\S]*attempt_span:/.test(genHistory), "genHistory result exposes compact recipe summary metadata");
ok(/if \(!db\) return \{ history: \[\], warning: "Supabase не настроен" \}/.test(genHistory), "missing Supabase is fail-open with warning");
ok(/const \{ data, error \} = await db[\s\S]*if \(error\) return \{ history: \[\], warning: error\.message\.slice\(0, 160\) \}/.test(genHistory), "Supabase query errors are surfaced as warning");
ok(/catch \(e\) \{[\s\S]*return \{ history: \[\], warning: String/.test(genHistory), "thrown history errors are surfaced as warning");
ok(/function summarizeHistory\(history: GenHistoryRow\[\]\)[\s\S]*outputs \+= 1[\s\S]*variants\.add\(variant\)[\s\S]*attempt_span: maxAttempt/.test(genHistory), "genHistory derives outputs, variants, and attempt span from recipe history");
ok(/const history = \(data as GenHistoryRow\[\]\) \|\| \[\];[\s\S]*return \{ history, summary: summarizeHistory\(history\) \}/.test(genHistory), "genHistory returns summary alongside raw history rows");
ok(/getRecipeHistory\(recipeId: number, limit = 50\): Promise<GenHistoryRow\[\]>[\s\S]*getRecipeHistoryResult\(recipeId, limit\)\)\.history/.test(genHistory), "legacy getRecipeHistory remains compatible");
ok(/import \{ getRecipeHistoryResult \} from/.test(route), "generation-history route uses result-aware helper");
ok(/summary: result\.summary \|\| null/.test(route) && /warning: result\.warning \|\| null/.test(route), "generation-history route returns summary and warning metadata");
ok(/Cache-Control": "no-store"/.test(route), "generation-history route is explicitly non-cacheable");

if (failed) process.exit(1);
console.log(`generationHistoryApi: ${passed} passed, ${failed} failed`);
