import assert from "node:assert/strict";
import test from "node:test";
import { aggregateUnitContributions, type UnitContribution } from "../lib/unit/groupAggregation";
import { mapLimitAllOrThrow } from "../lib/unit/mapLimit";

const base = (overrides: Partial<UnitContribution>): UnitContribution => ({
  cabinetId: "cab",
  nmId: 1,
  article: "SKU-1",
  orders: 0,
  revenue: 0,
  buyouts: 0,
  stock: 0,
  adSpend: 0,
  costPerUnit: 100,
  marketplacePct: 0,
  acquiringPct: 0,
  ratesFactual: true,
  ...overrides,
});

test("group aggregation is financially weighted, never percentage averaged", () => {
  const [row] = aggregateUnitContributions([
    base({ cabinetId: "a", orders: 10, revenue: 1_000, buyouts: 5, stock: 2, adSpend: 100, marketplacePct: 10, acquiringPct: 2 }),
    base({ cabinetId: "b", orders: 30, revenue: 6_000, buyouts: 24, stock: 8, adSpend: 300, marketplacePct: 20, acquiringPct: 1 }),
  ], { taxPct: 7, ff: 20 });

  assert.equal(row.orders, 40);
  assert.equal(row.revenue, 7_000);
  assert.equal(row.stock, 10);
  assert.equal(row.marketplaceRub, 1_300);
  assert.equal(row.marketplacePct, 1_300 / 7_000 * 100);
  assert.notEqual(row.marketplacePct, 15);
  assert.equal(row.acquiringRub, 80);
  assert.equal(row.drrPct, 400 / 7_000 * 100);
  assert.equal(row.buyoutPct, 29 / 40 * 100);
  assert.equal(row.marketplacePerUnit, 1_300 / 40);
  assert.equal(row.marginPerUnit, (7_000 - 4_000 - 800 - 1_300 - 80 - 490 - 400) / 40);
});

test("missing cost or factual rates remains unavailable", () => {
  const [missingCost] = aggregateUnitContributions([
    base({ orders: 1, revenue: 100, costPerUnit: null }),
  ], { taxPct: 7, ff: 0 });
  assert.equal(missingCost.costPerUnit, null);
  assert.equal(missingCost.marginPerUnit, null);

  const [missingRates] = aggregateUnitContributions([
    base({ orders: 1, revenue: 100, ratesFactual: false }),
  ], { taxPct: 7, ff: 0 });
  assert.equal(missingRates.marketplacePct, null);
  assert.equal(missingRates.marginPerUnit, null);
});

test("stock-only missing cost does not poison COGS, and zero revenue blanks ratios", () => {
  const [withStockOnly] = aggregateUnitContributions([
    base({ cabinetId: "a", orders: 2, revenue: 200, costPerUnit: 50, adSpend: 10 }),
    base({ cabinetId: "b", orders: 0, revenue: 0, stock: 9, costPerUnit: null }),
  ], { taxPct: 0, ff: 0 });
  assert.equal(withStockOnly.costPerUnit, 50);
  assert.notEqual(withStockOnly.marginPerUnit, null);

  const [zeroRevenue] = aggregateUnitContributions([
    base({ orders: 2, revenue: 0, adSpend: 30, marketplacePct: 10, acquiringPct: 1 }),
  ], { taxPct: 0, ff: 0 });
  assert.equal(zeroRevenue.drrPct, null);
  assert.equal(zeroRevenue.marketplacePct, null);
  assert.equal(zeroRevenue.marketplacePerUnit, null);
  assert.equal(zeroRevenue.marginBeforeDrrPct, null);
  assert.equal(zeroRevenue.marginAfterDrrPct, null);
  assert.equal(zeroRevenue.marginPerUnit, -115);
});

test("article mismatch for one nm_id fails visibly", () => {
  assert.throws(() => aggregateUnitContributions([
    base({ cabinetId: "a", article: "ONE" }),
    base({ cabinetId: "b", article: "TWO" }),
  ], { taxPct: 7, ff: 0 }));
});

test("fan-out concurrency is bounded and one failure yields no partial result", async () => {
  let active = 0;
  let maxActive = 0;
  const result = await mapLimitAllOrThrow([1, 2, 3, 4, 5], 3, async (value) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.ok(maxActive <= 3);

  let payload: number[] | undefined;
  await assert.rejects(async () => {
    payload = await mapLimitAllOrThrow([1, 2, 3], 2, async (value) => {
      if (value === 2) throw new Error("member failed");
      return value;
    });
  });
  assert.equal(payload, undefined);
});
