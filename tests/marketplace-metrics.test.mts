import assert from "node:assert/strict";
import test from "node:test";
import { MARKETPLACE_METRICS, marketplaceMetricStatus } from "../lib/analytics/marketplaceMetrics";

test("metric dictionary distinguishes order DRR from campaign-attributed DRR", () => {
  assert.match(MARKETPLACE_METRICS.drrOrders.definition, /всех заказов/);
  assert.match(MARKETPLACE_METRICS.drrAttributed.definition, /атрибутированные/);
  assert.match(MARKETPLACE_METRICS.marginBeforeAds.definition, /не итоговая прибыльность/);
});

test("DRR thresholds have one meaning on every marketplace screen", () => {
  assert.equal(marketplaceMetricStatus("drrOrders", 10), "good");
  assert.equal(marketplaceMetricStatus("drrAttributed", 15), "warning");
  assert.equal(marketplaceMetricStatus("drrOrders", 21), "danger");
  assert.equal(marketplaceMetricStatus("drrOrders", null), "unknown");
});

test("margin and funnel conversion fail visibly on weak values", () => {
  assert.equal(marketplaceMetricStatus("marginAfterMarketplace", -1), "danger");
  assert.equal(marketplaceMetricStatus("marginBeforeAds", 5), "warning");
  assert.equal(marketplaceMetricStatus("marginBeforeAds", 40), "neutral");
  assert.equal(marketplaceMetricStatus("ctr", 2.9), "warning");
  assert.equal(marketplaceMetricStatus("cartToOrderCr", 12), "good");
});
