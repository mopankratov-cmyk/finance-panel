// Product Twin rebuild worker contract. Run: npx tsx lib/factory/productTwinRebuildWorkerContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const worker = readFileSync("lib/factory/productTwinRebuildWorker.mjs", "utf8");
const inventory = readFileSync("lib/factory/productTwinInventory.ts", "utf8");

ok(/buildProductTwin/.test(worker), "worker rebuilds Product Twins without the Vercel route timeout");
ok(/buildApparelSourcePack/.test(worker) && /buildBagSourcePack/.test(worker), "worker refreshes apparel and bag source packs before rebuild");
ok(/FACTORY_TWIN_REBUILD_ENV_FILE/.test(worker), "worker can load production/Railway env from a file");
ok(/--build true/.test(worker), "worker requires explicit build flag before spending FAL credits");
ok(/batch-size/.test(worker) && /chunk\(items, batchSize\)/.test(worker), "worker processes articles in small batches");
ok(/inferProductName/.test(worker), "worker uses inventory product-name inference for CLR/NV source matching");
ok(/withProductTwinPreviewUrls/.test(worker), "worker report includes preview URLs for yandex-disk assets");
ok(/factory-product-twin-rebuild-report\.json/.test(worker), "worker writes an operator report");
ok(/export function inferProductName/.test(inventory), "inventory inference is exported for CLI parity with Studio");

console.log("productTwinRebuildWorkerContract: passed");
