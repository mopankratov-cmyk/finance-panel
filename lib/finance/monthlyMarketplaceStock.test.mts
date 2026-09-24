import assert from "node:assert/strict";
import test from "node:test";
import { moscowMonthSnapshot, valueMarketplaceStocks } from "./monthlyMarketplaceStock.ts";

test("месячный снимок разрешён только 1-го числа в 00:01 по Москве", () => {
  assert.deepEqual(moscowMonthSnapshot(new Date("2026-09-30T21:01:30Z")), {
    allowed: true,
    month: "2026-10-01",
    date: "2026-10-01",
    time: "00:01",
  });
  assert.equal(moscowMonthSnapshot(new Date("2026-09-30T21:00:59Z")).allowed, false);
  assert.equal(moscowMonthSnapshot(new Date("2026-09-30T21:02:00Z")).allowed, false);
});

test("остаток оценивается как количество × (себестоимость + упаковка)", () => {
  const rows = valueMarketplaceStocks(
    [{ article: "A-1", quantity: 2 }, { article: "a-1", quantity: 3 }],
    [{ article: "A-1", costRub: 100, packagingRub: 15 }],
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    article: "A-1", name: "A-1", quantity: 5,
    costRub: 100, packagingRub: 15, unitValue: 115, totalValue: 575,
  });
});

test("SKU без себестоимости не превращается в нулевую стоимость", () => {
  const [row] = valueMarketplaceStocks([{ article: "NEW", quantity: 7 }], []);
  assert.equal(row.quantity, 7);
  assert.equal(row.totalValue, null);
});
