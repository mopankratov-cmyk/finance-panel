import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOperationalPlanning } from "../lib/planning/operational";

test("operational planning summarizes orders, SKU demand and current stock", () => {
  const summary = summarizeOperationalPlanning({
    orders: [100_000, 200_000],
    skuOrders: {
      NORVIA_1: [10, 20],
      RIOBOX_1: [0, 5],
    },
    stocks: [7, 11],
  });
  assert.equal(summary.annualOrders, 300_000);
  assert.equal(summary.annualSkuUnits, 35);
  assert.deepEqual(summary.skuUnitsByMonth.slice(0, 2), [10, 25]);
  assert.deepEqual(summary.activeSkuByMonth.slice(0, 2), [1, 2]);
  assert.equal(summary.plannedSku, 2);
  assert.equal(summary.stock, 18);
});

test("operational planning rejects negative and non-finite values", () => {
  const summary = summarizeOperationalPlanning({
    orders: [-1, Number.NaN, 10],
    skuOrders: { NORVIA_1: [-5, Number.POSITIVE_INFINITY, 3] },
    stocks: [-10, 4],
  });
  assert.equal(summary.annualOrders, 10);
  assert.equal(summary.annualSkuUnits, 3);
  assert.equal(summary.stock, 4);
});
