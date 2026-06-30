// Contract test for Product Twin v0 routes. Run: npx tsx lib/factory/productTwinRouteContract.test.mts
import { readFileSync } from "node:fs";

const buildRoute = readFileSync("app/api/factory/product-twin/build/route.ts", "utf8");
const byIdRoute = readFileSync("app/api/factory/product-twin/[twin_id]/route.ts", "utf8");
const byArticleRoute = readFileSync("app/api/factory/product-twin/by-article/[article]/route.ts", "utf8");
const store = readFileSync("lib/factory/productTwinStore.ts", "utf8");

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗ " + m); } }

ok(/runNanoBananaEdit/.test(buildRoute), "build route creates clean source via FAL image edit");
ok(/buildTwinImageVariants/.test(buildRoute), "build route creates local asset variants");
ok(/persistProductTwin/.test(buildRoute), "build route persists Product Twin");
ok(/disk_path/.test(buildRoute) && /image_data_url/.test(buildRoute) && /image_url/.test(buildRoute), "build route accepts disk/data-url/image-url inputs");
ok(/disk: DISK/.test(store) && /product_twin/.test(store), "store writes product_twin rows into content_assets");
ok(/product_twin_asset/.test(store), "store writes per-asset metadata");
ok(/getProductTwinById/.test(byIdRoute), "by-id route reads a twin");
ok(/getLatestProductTwinByArticle/.test(byArticleRoute), "by-article route reads latest twin");

console.log(`\nproductTwinRouteContract: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

