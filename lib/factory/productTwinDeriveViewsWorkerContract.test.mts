// Product Twin derived views worker contract. Run: npx tsx lib/factory/productTwinDeriveViewsWorkerContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const worker = readFileSync("lib/factory/productTwinDeriveViewsWorker.mjs", "utf8");

ok(/getLatestProductTwinByArticle/.test(worker) && /getProductTwinById/.test(worker), "worker derives views from latest article twin or explicit twin id");
ok(/runNanoBananaEdit/.test(worker), "worker can generate planned view assets");
ok(/archiveExternalMediaToYandex/.test(worker), "worker archives derived views to Yandex Disk");
ok(/product_twin_view_asset/.test(worker), "worker persists product_twin_view_asset metadata");
ok(/rehostImageForFal/.test(worker), "worker resolves yandex-disk source assets for FAL");
ok(/FACTORY_TWIN_DERIVE_ENV_FILE/.test(worker), "worker can load production/Railway env from a file");
ok(/--generate true/.test(worker), "worker requires explicit generate flag before spending FAL credits");
ok(/allow-synthetic/.test(worker), "worker can opt into synthetic angle candidates");
ok(/per-twin-limit/.test(worker), "worker limits generated views per twin");
ok(/factory-product-twin-derived-views-report\.json/.test(worker), "worker writes an operator report");

console.log("productTwinDeriveViewsWorkerContract: passed");
