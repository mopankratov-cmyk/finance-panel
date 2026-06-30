// Contract test for /api/factory/product-broll-batch. Run: npx tsx lib/factory/productBrollBatchRouteContract.test.mts
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/factory/product-broll-batch/route.ts", "utf8");

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗ " + m); } }

ok(/const submit = body\.submit === true;/.test(route), "route requires explicit submit=true before spending FAL");
ok(/mode: "dry_run"/.test(route), "route supports dry_run planning mode");
ok(/prepare === true/.test(route) || /const prepare = body\.prepare === true;/.test(route), "source-prep is opt-in");
ok(/clean_first === true/.test(route) || /const cleanFirst = body\.clean_first === true/.test(route), "clean-source stage is explicit via clean_first=true");
ok(/runNanoBananaEdit/.test(route), "route can create a clean source before b-roll");
ok(/twin_id/.test(route) && /getBestProductTwinAsset/.test(route), "route can use Product Twin as b-roll source");
ok(/asset_id/.test(route), "route returns Product Twin asset provenance");
ok(/image_data_url\/disk_path требуют clean_first:true/.test(route), "disk/data-url inputs are gated through clean_first");
ok(/clean_source: cleanFirst/.test(route), "route returns clean_source metadata");
ok(/falVideoSubmitDetailed/.test(route), "route uses detailed FAL submit diagnostics");
ok(/status_route: "\/api\/factory\/video-fal-status\/\{task_id\}"/.test(route), "route returns existing status route hint");

console.log(`\nproductBrollBatchRouteContract: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
