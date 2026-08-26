import assert from "node:assert/strict";
import test from "node:test";
import { aggregateWeek } from "../lib/opiu/metrics";
import type { MonthWeek } from "../lib/opiu/weeks";

// Regression: ISSUE-005 — price before SPP was divided by finishedPrice after SPP.
test("weekly OPIU compares sales and orders on the same pre-SPP basis", () => {
  const week: MonthWeek = {
    label: "1–7 июля",
    weekStart: "2026-07-01",
    rangeFrom: "2026-07-01",
    rangeTo: "2026-07-07",
  };
  const metrics = aggregateWeek(
    week,
    [{ rr_dt: "2026-07-02", doc_type_name: "Продажа", retail_amount: 900, quantity: 1 }],
    [{ date: "2026-07-02", totalPrice: 1_000, discountPercent: 10, finishedPrice: 700, isCancel: false }],
    [],
    { byArticle: new Map(), byBarcode: new Map(), packagingByArticle: new Map(), packagingByBarcode: new Map(), costByGiBarcode: new Map(), packagingByGiBarcode: new Map() },
    0,
  );
  assert.equal(metrics.ordersRub, 900);
  assert.equal(metrics.revenue, 900);
});

test("weekly OPIU prefers stored order price before SPP when sync has it", () => {
  const week: MonthWeek = {
    label: "1–7 июля",
    weekStart: "2026-07-01",
    rangeFrom: "2026-07-01",
    rangeTo: "2026-07-07",
  };
  const metrics = aggregateWeek(
    week,
    [],
    [{ date: "2026-07-02", totalPrice: 1_000, discountPercent: 10, finishedPrice: 700, priceWithDisc: 880, isCancel: false }],
    [],
    { byArticle: new Map(), byBarcode: new Map(), packagingByArticle: new Map(), packagingByBarcode: new Map(), costByGiBarcode: new Map(), packagingByGiBarcode: new Map() },
    0,
  );

  assert.equal(metrics.ordersRub, 880);
});
