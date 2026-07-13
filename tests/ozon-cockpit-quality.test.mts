import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateOzonEconomyUnit,
  ozonAdCacheStatus,
  summarizeOzonEconomy,
  summarizeOzonHealth,
} from "../lib/ozon/cockpitQuality";

test("Ozon economy never treats missing cost as zero", () => {
  const result = calculateOzonEconomyUnit({
    price: 1_000,
    cost: 0,
    commission: 300,
    logistics: 100,
    acquiring: 20,
    ad: 50,
    tax: 70,
  });

  assert.deepEqual(result, {
    profit: null,
    margin: null,
    reliability: "missing_cost",
  });
});

test("Ozon economy summary excludes unknown-cost SKU from profit", () => {
  const summary = summarizeOzonEconomy([
    { units: 2, revenue: 2_000, profit: 100, reliability: "estimated" },
    { units: 5, revenue: 5_000, profit: null, reliability: "missing_cost" },
  ]);

  assert.deepEqual(summary, {
    calculatedProfit: 200,
    missingCost: 1,
    knownCostSku: 1,
    sku: 2,
    knownCostRevenue: 2_000,
    revenueCoveragePct: 28.6,
  });
});

test("Ozon ad cache becomes warning after two hours and error after six", () => {
  assert.equal(ozonAdCacheStatus(true, 1.9), "ok");
  assert.equal(ozonAdCacheStatus(true, 2.1), "warning");
  assert.equal(ozonAdCacheStatus(true, 6.1), "error");
  assert.equal(ozonAdCacheStatus(true, null), "warning");
});

test("Ozon health summary includes the latest sync failure", () => {
  assert.deepEqual(
    summarizeOzonHealth(["ok", "warning"], { status: "error" }),
    { healthy: 1, warnings: 1, errors: 1, sync: "error" },
  );
});
