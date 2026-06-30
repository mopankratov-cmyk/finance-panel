// Contract test for Product Twin v0 routes. Run: npx tsx lib/factory/productTwinRouteContract.test.mts
import { readFileSync } from "node:fs";

const buildRoute = readFileSync("app/api/factory/product-twin/build/route.ts", "utf8");
const byIdRoute = readFileSync("app/api/factory/product-twin/[twin_id]/route.ts", "utf8");
const byArticleRoute = readFileSync("app/api/factory/product-twin/by-article/[article]/route.ts", "utf8");
const classifyRoute = readFileSync("app/api/factory/product-twin/classify/route.ts", "utf8");
const store = readFileSync("lib/factory/productTwinStore.ts", "utf8");
const builder = readFileSync("lib/factory/productTwinBuild.ts", "utf8");
const classifier = readFileSync("lib/factory/productTwinClassification.ts", "utf8");

let pass = 0, fail = 0;
function ok(c: boolean, m: string) { if (c) pass++; else { fail++; console.error("✗ " + m); } }

ok(/buildProductTwin/.test(buildRoute), "build route delegates to shared Product Twin builder");
ok(/runNanoBananaEdit/.test(builder), "builder creates clean source via FAL image edit");
ok(/buildTwinImageVariants/.test(builder), "builder creates local asset variants");
ok(/object_mask/.test(store) && /alpha/.test(store) && /segmentation/.test(store), "store creates mask/alpha/segmentation assets for Product Twin pack");
ok(/object_coverage/.test(store) && /variant\.metrics/.test(builder), "builder stores mask coverage metrics");
ok(/qualityDetails/.test(builder), "builder stores quality critic details on assets");
ok(/persistProductTwin/.test(builder), "builder persists Product Twin");
ok(/disk_path/.test(builder) && /image_data_url/.test(builder) && /image_url/.test(builder), "builder accepts disk/data-url/image-url inputs");
ok(/disk: DISK/.test(store) && /product_twin/.test(store), "store writes product_twin rows into content_assets");
ok(/product_twin_asset/.test(store), "store writes per-asset metadata");
ok(/quality_details/.test(store), "store persists per-asset quality details");
ok(/getProductTwinById/.test(byIdRoute), "by-id route reads a twin");
ok(/getLatestProductTwinByArticle/.test(byArticleRoute), "by-article route reads latest twin");
ok(/classifyProductTwin/.test(classifyRoute), "classify route returns Product Twin classification");
ok(/canonical: Record<ProductTwinUseCase, string \| null>/.test(classifier), "classifier exposes canonical asset by use case");
ok(/dominantColor/.test(classifier) && /objectSize/.test(classifier), "classifier exposes asset metadata for downstream agents");

console.log(`\nproductTwinRouteContract: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
