// Run: npx tsx lib/factory/productBrollLearning.test.mts
import { strict as assert } from "node:assert";
import {
  assessProductBrollSource,
  buildProductBrollExperimentPlan,
  summarizeProductBrollFeedback,
} from "./productBrollLearning";

assert.equal(assessProductBrollSource({
  sourceKind: "product_twin_latest",
  assetKind: "shadow_bg",
  assetQuality: 0.9,
  assetRisk: "low",
}).ok, false, "paid b-roll should not use a shadow packshot by default");

assert.deepEqual(assessProductBrollSource({
  sourceKind: "product_twin",
  assetKind: "clean_png",
  assetQuality: 0.54,
  assetRisk: "high",
}).reasons, ["risk_high", "low_quality"], "high-risk low-quality sources are blocked");

assert.equal(assessProductBrollSource({
  sourceKind: "product_twin_view",
  assetKind: "product_twin_view",
  viewId: "hand_pickup",
  assetRisk: "low",
}).severity, "pass", "derived b-roll views can pass the paid source gate");

assert.equal(assessProductBrollSource({
  sourceKind: "product_twin",
  assetKind: "shadow_bg",
  allowPackshot: true,
}).ok, true, "operator can explicitly override packshot gate for smoke tests");

const blockedPlan = buildProductBrollExperimentPlan({
  article: "YYS0101",
  sourceKind: "product_twin_latest",
  assetKind: "shadow_bg",
  assetQuality: 0.54,
  assetRisk: "high",
  variants: [{ id: "v1", label: "hand pickup" }],
});
assert.equal(blockedPlan.mode, "blocked");
assert.ok(blockedPlan.next_actions.some((item) => item.includes("derive product views")));

const feedback = summarizeProductBrollFeedback({ verdict: "reject", reasons: ["packshot_only"], note: "static hero only" });
assert.equal(feedback.score, 0);
assert.equal(feedback.next_action, "avoid this source/view/motion pattern in the next experiment");

console.log("productBrollLearning.test: passed");
