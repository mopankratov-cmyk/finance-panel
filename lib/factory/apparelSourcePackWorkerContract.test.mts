// Apparel source pack worker contract. Run: npx tsx lib/factory/apparelSourcePackWorkerContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const worker = readFileSync("lib/factory/apparelSourcePackWorker.mjs", "utf8");
const helper = readFileSync("lib/factory/apparelSourcePack.ts", "utf8");

ok(/buildApparelSourcePack/.test(worker), "worker builds source packs without HTTP");
ok(/buildBagSourcePack/.test(worker) && /bagSourcePackRows/.test(worker), "worker supports bag source packs");
ok(/apparelSourcePackRows/.test(worker), "worker serializes source-pack rows");
ok(/--article NV-08/.test(worker), "worker documents single-article usage");
ok(/--articles NV-08,NV-836/.test(worker), "worker supports bulk articles");
ok(/--items must be a JSON array/.test(worker), "worker supports explicit article/product JSON items");
ok(/FACTORY_SOURCE_PACK_ENV_FILE/.test(worker), "worker can load env from production/Railway file");
ok(/apply/.test(worker) && /upsert\(rows/.test(worker), "worker writes to Supabase only in apply mode");
ok(/factory-apparel-source-pack-report\.json/.test(worker), "worker writes an operator report");
ok(/productColorHint\(product: string\)[\s\S]*\|\| ""/.test(helper), "source pack does not require a color hint for article-only runs");

console.log("apparelSourcePackWorkerContract: passed");
