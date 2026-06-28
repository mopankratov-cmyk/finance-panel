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

const route = readFileSync("app/api/factory/prepare-drafts/route.ts", "utf8");
const helper = readFileSync("lib/factory/recipeTransfer.ts", "utf8");
const recipes = readFileSync("app/api/factory/recipes/route.ts", "utf8");

ok(/export async function POST/.test(route), "prepare-drafts exposes POST route");
ok(/const count = Math\.max\(1, Math\.min\(10, Number\(body\.count\) \|\| 5\)\);/.test(route), "prepare-drafts clamps batch size");
ok(/status", "draft"/.test(route), "prepare-drafts counts existing draft recipes");
ok(/limit\(Math\.max\(count \* 5, DRAFT_LOOKUP_LIMIT\)\)/.test(route), "prepare-drafts scans a wider draft window than one batch");
ok(/const sourceReadyExisting = await resolveSourceReadyArticles\(db, existingArticles\);/.test(route), "prepare-drafts checks which existing drafts are source-ready");
ok(/const existingReadyDrafts = existing\.filter/.test(route), "prepare-drafts counts only source-ready drafts as ready queue");
ok(/node_templates/.test(route), "prepare-drafts uses existing templates");
ok(/node_recipes/.test(route), "prepare-drafts reuses existing recipe articles");
ok(/resolveSourceReadyArticles/.test(route), "prepare-drafts prefers source-ready articles");
ok(/const existingDraftArticles = new Set/.test(route), "prepare-drafts tracks already queued draft articles");
ok(/const freshReadyArticles = readyArticles\.filter/.test(route), "prepare-drafts prefers fresh source-ready articles first");
ok(/transferRecipeTemplate/.test(route), "prepare-drafts creates drafts through shared transfer helper");
ok(/built_by: "series_prepare"/.test(route), "prepare-drafts marks generated drafts as series preparation");
ok(/force_niche: true/.test(route), "prepare-drafts preserves the requested series niche");
ok(!/graph-run/.test(route), "prepare-drafts does not start graph-run");
ok(!/\/batch/.test(route), "prepare-drafts does not call batch launch");
ok(/dry_run/.test(route), "prepare-drafts supports dry-run planning");
ok(/ready: existingReadyDrafts\.length \+ plan\.length >= count/.test(route) || /ready: draftIds\.length >= count/.test(route), "prepare-drafts returns readiness from usable drafts");

ok(/export async function transferRecipeTemplate/.test(helper), "shared transfer helper is exported");
ok(/status: "draft"/.test(helper), "transfer helper creates draft recipes");
ok(/built_by: p\.built_by \|\| "manual"/.test(helper), "transfer helper preserves existing manual behavior by default");
ok(/p\.force_niche \? \(niche \|\| nicheFromArticle\(article, productName\)\) : \(nicheFromArticle\(article, productName\) \|\| niche\)/.test(helper), "transfer helper can preserve niche for series preparation");
ok(/function specializeText/.test(helper), "transfer helper specializes template text deterministically");
ok(/product_article: article/.test(helper), "transfer helper writes product article into node params");
ok(/product_name: productName \|\| null/.test(helper), "transfer helper writes product name into node params");
ok(/agent_suggestion:[\s\S]*product_article: article/.test(helper), "transfer helper carries product context into agent suggestion");
ok(/transferRecipeTemplate/.test(recipes), "recipes route uses shared transfer helper");

if (failed) process.exit(1);
console.log(`prepareDraftsContract: ${passed} passed, ${failed} failed`);
