// Product Twin preparation plan fixtures. Run: npx tsx lib/factory/productTwinPrepPlan.test.mts
import { strict as assert } from "node:assert";
import { buildProductTwinPreparationPlan } from "./productTwinPrepPlan";

const apparel = buildProductTwinPreparationPlan({ article: "NV-08", product: "NORVIA jacket", category: "apparel" });
assert.equal(apparel.version, "product_twin_prep_v1");
assert.ok(apparel.canonicalViews.some((v) => v.id === "front_flat" && v.required), "apparel requires clean front garment");
assert.ok(apparel.canonicalViews.some((v) => v.id === "back_flat" && v.truth === "synthetic_candidate"), "apparel plans synthetic candidate back view");
assert.ok(apparel.canonicalViews.some((v) => v.id === "on_model_front" && v.truth === "truthful_source"), "apparel keeps on-model truth asset");
assert.ok(apparel.serviceAssets.some((v) => v.id === "depth_map"), "apparel includes service assets");

const bag = buildProductTwinPreparationPlan({ article: "CLR00716", product: "CLERIN crossbody bag", category: "bag" });
assert.ok(bag.canonicalViews.some((v) => v.id === "front" && v.required), "bag requires front clean view");
assert.ok(bag.canonicalViews.some((v) => v.id === "hardware_macro" && v.required), "bag requires hardware/detail macro");
assert.ok(bag.canonicalViews.some((v) => v.id === "in_hand" && v.truth === "truthful_source"), "bag keeps in-hand truth asset");

const cosmetics = buildProductTwinPreparationPlan({ article: "YYS0101", product: "YOYO SPF50", category: "cosmetics" });
assert.ok(cosmetics.notes.join(" ").includes("label detail"), "cosmetics plan blocks b-roll until label detail passes");

console.log("productTwinPrepPlan: passed");
