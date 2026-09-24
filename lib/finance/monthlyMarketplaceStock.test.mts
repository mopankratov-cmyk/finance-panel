import assert from "node:assert/strict";
import test from "node:test";
import { fulfillmentReconciliation, moscowMonthSnapshot, valueMarketplaceStocks } from "./monthlyMarketplaceStock.ts";

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

test("фулфилмент всегда пересчитывается по одной границе месяца до закрытия периода", () => {
  const second = fulfillmentReconciliation(new Date("2026-10-02T03:10:00Z"));
  assert.deepEqual(second, { month: "2026-10-01", cutoff: "2026-10-01T00:00:00+03:00", closeThrough: "2026-09-30" });
  assert.equal(fulfillmentReconciliation(new Date("2026-10-29T03:10:00Z")).cutoff, second.cutoff);
});

test("остаток оценивается как количество × (себестоимость + упаковка)", () => {
  const rows = valueMarketplaceStocks(
    [{ article: "A-1", quantity: 2 }, { article: "a-1", quantity: 3 }],
    [{ article: "A-1", costRub: 100, packagingRub: 15 }],
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    lineKey: "A-1", article: "A-1", name: "A-1", locationName: null, reference: null, quantity: 5,
    costRub: 100, packagingRub: 15, unitValue: 115, totalValue: 575,
  });
});

test("одинаковый артикул можно показать отдельно по местам хранения", () => {
  const rows = valueMarketplaceStocks(
    [
      { article: "A-1", lineKey: "warehouse-1:A-1", locationName: "Коледино", quantity: 2 },
      { article: "A-1", lineKey: "warehouse-2:A-1", locationName: "Казань", quantity: 3 },
    ],
    [{ article: "A-1", costRub: 100, packagingRub: 15 }],
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.locationName, row.quantity, row.totalValue]), [
    ["Коледино", 2, 230],
    ["Казань", 3, 345],
  ]);
});

test("SKU без себестоимости не превращается в нулевую стоимость", () => {
  const [row] = valueMarketplaceStocks([{ article: "NEW", quantity: 7 }], []);
  assert.equal(row.quantity, 7);
  assert.equal(row.totalValue, null);
});

test("остаток без упаковки оценивается только по себестоимости", () => {
  const [row] = valueMarketplaceStocks(
    [{ article: "FF-1", quantity: 4 }],
    [{ article: "FF-1", costRub: 125, packagingRub: 0 }],
  );
  assert.equal(row.packagingRub, 0);
  assert.equal(row.unitValue, 125);
  assert.equal(row.totalValue, 500);
});
