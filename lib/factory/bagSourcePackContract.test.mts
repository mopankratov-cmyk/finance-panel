// Bag source pack contract. Run: npx tsx lib/factory/bagSourcePackContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const helper = readFileSync("lib/factory/bagSourcePack.ts", "utf8");
const picker = readFileSync("lib/factory/productSourcePicker.ts", "utf8");
const inventory = readFileSync("lib/factory/productTwinInventory.ts", "utf8");
const batch = readFileSync("app/api/factory/product-twin/batch-build/route.ts", "utf8");

ok(/buildBagSourcePack/.test(helper), "bag source pack builder is exported");
ok(/front/.test(helper) && /three_quarter/.test(helper) && /hardware_macro/.test(helper) && /in_hand/.test(helper), "bag source pack covers required bag roles");
ok(/ARTICLE_FOLDERS/.test(helper) && /\/Сумки\//.test(helper), "bag source pack uses explicit bag folders");
ok(/cover_like/.test(helper), "bag source pack skips covers");
ok(/product_truth/.test(helper), "bag source pack rows are product_truth assets");
ok(/source_pack_role:/.test(picker) && /buildBagSourcePack/.test(picker), "source picker can prefer bag source-pack candidates");
ok(/ProductSourcePackReadiness/.test(inventory), "inventory exposes product source-pack readiness");
ok(/buildApparelSourcePack/.test(inventory) && /buildBagSourcePack/.test(inventory), "inventory checks apparel and bag packs");
ok(/source_pack_readiness/.test(batch), "batch dry-run returns source-pack readiness");

console.log("bagSourcePackContract: passed");
