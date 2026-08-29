import { strict as assert } from "node:assert";
import { test } from "node:test";
import { sumOzonEconomyRows } from "../lib/ozon/economyTotals.ts";

test("итог считается по обороту, а не сложением колонок «на штуку»", () => {
  const totals = sumOzonEconomyRows([
    { units: 10, revenue: 3_000, ad: 30, tax: 21, profit: 100 },
    { units: 5, revenue: 2_000, ad: 40, tax: 28, profit: 200 },
  ]);
  assert.equal(totals.units, 15);
  assert.equal(totals.revenue, 5_000);
  assert.equal(totals.ad, 10 * 30 + 5 * 40);
  assert.equal(totals.tax, 10 * 21 + 5 * 28);
  assert.equal(totals.profit, 10 * 100 + 5 * 200);
});

test("строки без себестоимости не попадают в прибыль и маржу", () => {
  const totals = sumOzonEconomyRows([
    { units: 10, revenue: 3_000, ad: 0, tax: 0, profit: 300 },
    { units: 4, revenue: 1_000, ad: 0, tax: 0, profit: null },
  ]);
  assert.equal(totals.profit, 3_000);
  assert.equal(totals.profitRows, 1);
  assert.equal(totals.profitRevenue, 3_000);
  // Маржа считается от выручки тех же строк, а не от всего оборота.
  assert.equal(totals.margin, 100);
  assert.equal(totals.revenueCoverage, 75);
});

test("пустая таблица не делит на ноль", () => {
  const totals = sumOzonEconomyRows([]);
  assert.equal(totals.rows, 0);
  assert.equal(totals.margin, null);
  assert.equal(totals.revenueCoverage, null);
});

test("непроданные товары не двигают итог", () => {
  const totals = sumOzonEconomyRows([
    { units: 0, revenue: 0, ad: 25, tax: 10, profit: -500 },
    { units: 2, revenue: 1_000, ad: 10, tax: 35, profit: 150 },
  ]);
  assert.equal(totals.ad, 20);
  assert.equal(totals.profit, 300);
  assert.equal(totals.units, 2);
});
