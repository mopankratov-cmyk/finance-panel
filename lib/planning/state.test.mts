import assert from "node:assert/strict";
import test from "node:test";
import { mergePlanningBlock, normalizePlanningBlock, selectPlanningBlock } from "./state";

test("planning state keeps the legacy aggregate block as a cabinet fallback", () => {
  const state = { orders: Array(12).fill(10), norms: { buyout: 80 }, sku_orders: {} };
  assert.deepEqual(selectPlanningBlock(state, "cabinet-a").orders, Array(12).fill(10));
});

test("saving a cabinet plan preserves aggregate and other cabinet plans", () => {
  const state = {
    orders: Array(12).fill(1),
    by_cabinet: { "cabinet-b": { orders: Array(12).fill(2) } },
  };
  const next = mergePlanningBlock(state, "cabinet-a", {
    orders: Array(12).fill(3),
    norms: { buyout: 75 },
    sku_orders: {},
  });
  assert.deepEqual(next.orders, Array(12).fill(1));
  assert.deepEqual(selectPlanningBlock(next, "cabinet-a").orders, Array(12).fill(3));
  assert.deepEqual(selectPlanningBlock(next, "cabinet-b").orders, Array(12).fill(2));
});

test("malformed month arrays are normalized to twelve numeric values", () => {
  assert.deepEqual(normalizePlanningBlock({ orders: [1, 2] }).orders, Array(12).fill(0));
});
