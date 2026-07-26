import assert from "node:assert/strict";
import test from "node:test";

import { buildRnpArticleCompare, type RnpCompareSku } from "./articleCompare";

function sku(nm: number, art: string, values: Array<number | null>, total: number | null): RnpCompareSku {
  return {
    nm,
    art,
    name: art,
    metrics: [
      {
        field: "orders_sum",
        label: "Заказы, ₽",
        kind: "money",
        daily: values,
        total,
      },
    ],
  };
}

function funnelSku(nm: number, art: string, openCard: Array<number | null>, cart: Array<number | null>): RnpCompareSku {
  return {
    nm,
    art,
    name: art,
    metrics: [
      { field: "open_card", label: "Переходы в карточку", kind: "int", daily: openCard, total: openCard.reduce<number>((sum, value) => sum + (value ?? 0), 0) },
      { field: "cart", label: "В корзину", kind: "int", daily: cart, total: cart.reduce<number>((sum, value) => sum + (value ?? 0), 0) },
    ],
  };
}

test("RNP article compare picks top SKU by selected metric and builds daily points", () => {
  const compare = buildRnpArticleCompare(
    [
      sku(1, "LOW", [10, 20], 30),
      sku(2, "HIGH", [100, null], 100),
      sku(3, "MID", [40, 30], 70),
    ],
    [
      { label: "01", period_type: "ср" },
      { label: "02", period_type: "чт" },
    ],
    "orders_sum",
    2,
  );

  assert.equal(compare.metricLabel, "Заказы, ₽");
  assert.equal(compare.metricKind, "money");
  assert.deepEqual(compare.lines.map((line) => line.label), ["HIGH", "MID"]);
  assert.deepEqual(compare.points, [
    { date: "01", weekday: "ср", sku_2: 100, sku_3: 40 },
    { date: "02", weekday: "чт", sku_2: null, sku_3: 30 },
  ]);
});

test("RNP article compare can expose every eligible SKU for manual selection", () => {
  const compare = buildRnpArticleCompare(
    [
      sku(1, "LOW", [10], 10),
      sku(2, "HIGH", [100], 100),
      sku(3, "MID", [40], 40),
    ],
    [{ label: "01", period_type: "ср" }],
    "orders_sum",
    99,
  );

  assert.deepEqual(compare.lines.map((line) => line.label), ["HIGH", "MID", "LOW"]);
  assert.deepEqual(compare.points, [{ date: "01", weekday: "ср", sku_2: 100, sku_3: 40, sku_1: 10 }]);
});

test("RNP article compare returns an empty chart model without matching metrics", () => {
  const compare = buildRnpArticleCompare(
    [sku(1, "NO-AD", [10], 10)],
    [{ label: "01", period_type: "ср" }],
    "ad_spent",
    5,
  );

  assert.equal(compare.metricField, "ad_spent");
  assert.equal(compare.metricLabel, "ad_spent");
  assert.equal(compare.metricKind, "int");
  assert.deepEqual(compare.lines, []);
  assert.deepEqual(compare.points, [{ date: "01", weekday: "ср" }]);
});

test("RNP article compare derives cart conversion from funnel metrics", () => {
  const compare = buildRnpArticleCompare(
    [funnelSku(1, "CR", [100, 0, 50], [20, 1, 15])],
    [
      { label: "01", period_type: "ср" },
      { label: "02", period_type: "чт" },
      { label: "03", period_type: "пт" },
    ],
    "cart_conversion",
  );

  assert.equal(compare.metricLabel, "CR в корзину, %");
  assert.equal(compare.metricKind, "pct");
  assert.equal(compare.lines[0]?.nm, 1);
  assert.equal(compare.lines[0]?.total, 24);
  assert.deepEqual(compare.points, [
    { date: "01", weekday: "ср", sku_1: 20 },
    { date: "02", weekday: "чт", sku_1: null },
    { date: "03", weekday: "пт", sku_1: 30 },
  ]);
});
