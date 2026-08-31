import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { composeRnpSummaryFromSkus } from "../lib/rnp/summaryFromSkus";

// Сводка по фильтру (бренд/категория/теги) пересобирается из выбранных SKU.
// Главный закон: производные считаются из СУММ, а не усреднением процентов —
// среднее из ДРР двух SKU с разными оборотами исказило бы агрегат.

const metric = (field: string, kind: string, daily: (number | null)[], total: number | null, forecast: number | null = null) =>
  ({ field, kind, daily, total, forecast, label: field });

const skuA = { metrics: [
  metric("orders_count", "int", [10, 20], 30, 33),
  metric("orders_sum", "money", [1000, 2000], 3000, 3300),
  metric("ad_spent", "money", [100, 100], 200),
  metric("drr", "pct", [10, 5], 6.7),
  metric("buyouts_count", "int", [5, 10], 15),
  metric("buyouts_sum", "money", [500, 1000], 1500),
  metric("clicks", "int", [50, 50], 100),
  metric("views", "int", [1000, 1000], 2000),
  metric("reviews_count", "int", [2, 0], 2),
  metric("reviews_rating", "pct", [5, null], 5),
  metric("stock_total", "int", [40, 40], 40),
] };
// SKU с оборотом в 10 раз меньше, но огромным ДРР: среднее по строкам дало бы
// (6.7+50)/2 ≈ 28%, честная сумма — (200+100)/(3000+200)×100 ≈ 9.4%.
const skuB = { metrics: [
  metric("orders_count", "int", [1, 1], 2, 2),
  metric("orders_sum", "money", [100, 100], 200, 220),
  metric("ad_spent", "money", [50, 50], 100),
  metric("drr", "pct", [50, 50], 50),
  metric("buyouts_count", "int", [1, 0], 1),
  metric("buyouts_sum", "money", [100, 0], 100),
  metric("clicks", "int", [0, 10], 10),
  metric("views", "int", [500, 500], 1000),
  metric("reviews_count", "int", [1, 0], 1),
  metric("reviews_rating", "pct", [2, null], 2),
  metric("stock_total", "int", [8, 8], 8),
] };

const TEMPLATE = [
  metric("orders_count", "int", [null, null], null),
  metric("orders_sum", "money", [null, null], null),
  metric("drr", "pct", [null, null], null),
  metric("ctr", "pct", [null, null], null),
  metric("buyout_pct", "pct", [null, null], null),
  metric("avg_order_price", "money", [null, null], null),
  metric("reviews_rating", "pct", [null, null], null),
  metric("turnover", "int", [null, 12], 12),
];

test("суммируемые метрики складываются по дням и итогам, прогноз — суммой", () => {
  const summary = composeRnpSummaryFromSkus(TEMPLATE, [skuA, skuB], 30);
  const orders = summary.find((item) => item.field === "orders_count")!;
  assert.deepEqual(orders.daily, [11, 21]);
  assert.equal(orders.total, 32);
  assert.equal(orders.forecast, 35);
});

test("ДРР считается из сумм, а не средним по строкам", () => {
  const summary = composeRnpSummaryFromSkus(TEMPLATE, [skuA, skuB], 30);
  const drr = summary.find((item) => item.field === "drr")!;
  // (200+100)/(3000+200)×100 = 9.4 — а не (6.7+50)/2 ≈ 28.
  assert.equal(drr.total, 9.4);
  assert.equal(drr.daily[0], Math.round((150 / 1100) * 1000) / 10);
  // Прогноз производной честно пуст — его не из чего сложить.
  assert.equal(drr.forecast, null);
});

test("CTR, выкуп потока и средняя цена — по формулам сервера", () => {
  const summary = composeRnpSummaryFromSkus(TEMPLATE, [skuA, skuB], 30);
  assert.equal(summary.find((item) => item.field === "ctr")!.total, Math.round((110 / 3000) * 1000) / 10);
  assert.equal(summary.find((item) => item.field === "buyout_pct")!.total, 50);
  assert.equal(summary.find((item) => item.field === "avg_order_price")!.total, 100);
});

test("рейтинг отзывов — взвешенный по числу отзывов, не среднее строк", () => {
  const summary = composeRnpSummaryFromSkus(TEMPLATE, [skuA, skuB], 30);
  // (5×2 + 2×1) / 3 = 4 — а не (5+2)/2 = 3.5.
  assert.equal(summary.find((item) => item.field === "reviews_rating")!.total, 4);
});

test("оборачиваемость: суммарный остаток / средние дневные выкупы (формула сервера)", () => {
  const summary = composeRnpSummaryFromSkus(TEMPLATE, [skuA, skuB], 30);
  // Остаток 48, выкупы по дням 6 и 10 → среднее 8 → 6 дней.
  const turnover = summary.find((item) => item.field === "turnover")!;
  assert.equal(turnover.total, 6);
  // Точечная метрика живёт там же, где в шаблоне (последний день).
  assert.deepEqual(turnover.daily, [null, 6]);
});

test("страница подменяет сводку и её дельты только при активных фильтрах", async () => {
  const page = await readFile(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
  assert.match(page, /sortedSkus\.length !== activeData\.skus\.length/);
  assert.match(page, /completeMetrics\(displaySummary/);
  // Дельты сводки считаются по тому же отфильтрованному набору артикулов.
  assert.match(page, /previousSkus = activePrevious\.skus\.filter\(\(sku\) => visibleNms\.has\(sku\.nm\)\)/);
  assert.match(page, /сводка по фильтру/);
});

test("фактический % выкупа под фильтром считается по той же формуле, что на сервере", async () => {
  // Доставлено 10 (брутто), из них оставили 8 → 80%. Прежняя формула делила на
  // «брутто + возвраты» = 12 и завышала показатель до 83.3%.
  const sku = { metrics: [
    metric("buyouts_count", "int", [8], 8),
    metric("buyouts_gross_count", "int", [10], 10),
    metric("returns_count", "int", [2], 2),
  ] };
  const summary = composeRnpSummaryFromSkus([metric("actual_buyout_pct", "pct", [null], null)], [sku], 30);
  assert.equal(summary[0].total, 80);
  assert.equal(summary[0].daily[0], 80);

  // Формула обязана совпадать с серверной буквально: расхождение здесь означает
  // две разные правды на одном экране — с фильтром и без.
  const server = await readFile(new URL("../lib/rnp/buildTable.ts", import.meta.url), "utf8");
  assert.match(server, /r1\(\(buyoutsCount\[index\] \/ grossBuyoutsCount\[index\]\) \* 100\)/);
});

test("маржа под фильтром делится на выкупы только посчитанных SKU", () => {
  // Половина ассортимента без себестоимости: сервер делит прибыль на выкупы
  // тех SKU, где прибыль известна. Общий знаменатель занижал маржу вдвое, и по
  // этой цифре принимали решение поднять цены.
  const withCost = { metrics: [
    metric("gross", "money", [100_000], 100_000),
    metric("buyouts_sum", "money", [500_000], 500_000),
  ] };
  const withoutCost = { metrics: [
    metric("buyouts_sum", "money", [500_000], 500_000),
  ] };
  const summary = composeRnpSummaryFromSkus(
    [metric("margin_pct", "pct", [null], null)],
    [withCost, withoutCost],
    30,
  );
  assert.equal(summary[0].total, 20);
  assert.equal(summary[0].daily[0], 20);
});

test("доля отмен под фильтром считается к оформленным заказам", () => {
  const sku = { metrics: [
    metric("cancels_count", "int", [10], 10),
    metric("orders_count", "int", [90], 90),
  ] };
  const summary = composeRnpSummaryFromSkus([metric("cancel_pct", "pct", [null], null)], [sku], 30);
  assert.equal(summary[0].total, 10, "10 из 100 оформленных, а не 10 из 90 дошедших");
});
