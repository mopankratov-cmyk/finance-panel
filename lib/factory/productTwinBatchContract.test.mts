// Contract test for Product Twin inventory/best-of-N/batch/view derivation.
// Run: npx tsx lib/factory/productTwinBatchContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const inventoryRoute = readFileSync("app/api/factory/product-twin/inventory/route.ts", "utf8");
const bestRoute = readFileSync("app/api/factory/product-twin/best-of-n/route.ts", "utf8");
const batchRoute = readFileSync("app/api/factory/product-twin/batch-build/route.ts", "utf8");
const deriveRoute = readFileSync("app/api/factory/product-twin/derive-views/route.ts", "utf8");
const inventory = readFileSync("lib/factory/productTwinInventory.ts", "utf8");
const bestOfN = readFileSync("lib/factory/productTwinBestOfN.ts", "utf8");
const yandex = readFileSync("lib/factory/yandexArchive.ts", "utf8");
const store = readFileSync("lib/factory/productTwinStore.ts", "utf8");

ok(/isAuthorizedReelsBrainJobRequest/.test(inventoryRoute), "inventory route is protected");
ok(/buildProductTwinInventory/.test(inventoryRoute), "inventory route builds all-SKU inventory");
ok(/productTwinInventorySummary/.test(inventoryRoute), "inventory route returns summary");
ok(/pickProductSourceCandidates/.test(inventory), "inventory ranks source candidates");
ok(/buildProductTwinPreparationPlan/.test(inventory), "inventory attaches maximum prep plan readiness");

ok(/buildProductTwinBestOfN/.test(bestRoute), "best-of-N route delegates to shared runner");
ok(/attempts_requested/.test(bestRoute), "best-of-N route returns attempts");
ok(/winner/.test(bestRoute) && /yandex_assets/.test(bestRoute), "best-of-N route returns winner and Yandex assets");
ok(/winnerScore/.test(bestOfN) && /brollReady/.test(bestOfN), "best-of-N selects by quality and readiness");

ok(/mode: "dry_run"/.test(batchRoute), "batch route defaults to dry-run");
ok(/build_hint/.test(batchRoute), "batch route requires explicit build flag");
ok(/best_of_n/.test(batchRoute) && /buildProductTwinBestOfN/.test(batchRoute), "batch route can run best-of-N");
ok(/yandex_asset_paths/.test(batchRoute), "batch route returns uploaded Yandex asset paths");

ok(/derive-views crash/.test(deriveRoute), "derive-views route exists");
ok(/generate_hint/.test(deriveRoute), "derive-views route defaults to dry-run");
ok(/runNanoBananaEdit/.test(deriveRoute), "derive-views can generate planned view assets");
ok(/archiveExternalMediaToYandex/.test(deriveRoute), "derive-views archives generated views to Yandex Disk");
ok(/product_twin_view_asset/.test(deriveRoute), "derive-views persists view asset metadata");
ok(/rehostImageForFal/.test(deriveRoute), "derive-views resolves yandex-disk assets for FAL");

ok(/folderSegments/.test(yandex), "Yandex archive supports nested folder segments");
ok(/folderSegments:\s*\[\s*input\.article,\s*input\.twinId\s*\]/.test(store), "Product Twin uploads are grouped by article/twin folders");

console.log("productTwinBatchContract: passed");
