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
ok(/if \(!db\) return \{ history: \[\], warning: "Supabase не настроен" \}/.test(genHistory), "missing Supabase is fail-open with warning");
ok(/const \{ data, error \} = await db[\s\S]*if \(error\) return \{ history: \[\], warning: error\.message\.slice\(0, 160\) \}/.test(genHistory), "Supabase query errors are surfaced as warning");
ok(/catch \(e\) \{[\s\S]*return \{ history: \[\], warning: String/.test(genHistory), "thrown history errors are surfaced as warning");
ok(/getRecipeHistory\(recipeId: number, limit = 50\): Promise<GenHistoryRow\[\]>[\s\S]*getRecipeHistoryResult\(recipeId, limit\)\)\.history/.test(genHistory), "legacy getRecipeHistory remains compatible");
ok(/import \{ getRecipeHistoryResult \} from/.test(route), "generation-history route uses result-aware helper");
ok(/warning: result\.warning \|\| null/.test(route), "generation-history route returns warning metadata");

if (failed) process.exit(1);
console.log(`generationHistoryApi: ${passed} passed, ${failed} failed`);
