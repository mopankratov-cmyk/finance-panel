import { strict as assert } from "node:assert";
import test from "node:test";

import { applyMetricForecasts, buildMetrics, skuForecastFloors, type Metric } from "../lib/rnp/buildTable";
import { forecastAdditiveMetric, forecastRatioMetric } from "../lib/rnp/forecast";
import { composeRnpSummaryFromSkus } from "../lib/rnp/summaryFromSkus";

/**
 * Живая проверка фазы 1 на проде 29.09.2026 (кабинет Оптимы, 22–29.09): прогноз
 * заказов строится от последнего дня воронки (28.09), и 71 уже пришедший заказ
 * за 29.09 заменялся проекцией дня в 49 — прогноз периода 490 при факте 512.
 * То же у 14 строк артикулов. Неполный день — нижняя граница, а не пустота.
 */

const WEEK = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"];
const FLAT = [60, 60, 60, 60, 60, 60, 60];

test("неполный день выше проекции — прогноз и вилка не ниже уже пришедшего", () => {
  const result = forecastAdditiveMetric(WEEK, [...FLAT, 71], "2026-09-27", { partialAfterAsOf: true })!;
  assert.equal(result.value, 420 + 71, "проекция дня 60 < 71 пришедших");
  assert.equal(result.low, 420 + 71);
  assert.ok(result.high > result.value);
  assert.match(result.method, /не ниже уже пришедшего/);
});

test("неполный день ниже проекции — проекция остаётся, низ вилки не ниже факта", () => {
  const result = forecastAdditiveMetric(WEEK, [...FLAT, 20], "2026-09-27", { partialAfterAsOf: true })!;
  assert.equal(result.value, 420 + 60);
  assert.ok(result.low >= 420 + 20);
});

test("без опции и без неполных дней — прежняя математика байт-в-байт", () => {
  const gross = [120, -300, 45, 80, -10, 200, 15, null];
  const before = forecastAdditiveMetric(WEEK, gross, "2026-09-27");
  assert.deepEqual(forecastAdditiveMetric(WEEK, gross, "2026-09-27", { partialAfterAsOf: true }), before);
  // Значение после asOf без опции по-прежнему не участвует.
  assert.deepEqual(forecastAdditiveMetric(WEEK, [...FLAT, 71], "2026-09-27"), forecastAdditiveMetric(WEEK, [...FLAT, null], "2026-09-27"));
});

test("доля: метод — от части, которая ещё прогнозируется", () => {
  const spend = forecastAdditiveMetric(WEEK, [...FLAT, 60], "2026-09-28");
  const orders = forecastAdditiveMetric(WEEK, [...FLAT, 71], "2026-09-27", { partialAfterAsOf: true });
  const drr = forecastRatioMetric(spend, orders)!;
  assert.doesNotMatch(drr.method, /Завершённый период/, "реклама за день полная, а заказы — нет");
});

test("доля: пометка о неполном дне — и когда открытых дней у частей поровну", () => {
  // Утро: реклама есть по вчера, заказы — по вчера по воронке плюс статистика за сегодня.
  const spend = forecastAdditiveMetric(WEEK, [...FLAT, null], "2026-09-27");
  const orders = forecastAdditiveMetric(WEEK, [...FLAT, 71], "2026-09-27", { partialAfterAsOf: true });
  assert.equal(spend!.futureDays, orders!.futureDays);
  assert.match(forecastRatioMetric(spend, orders)!.method, /не ниже уже пришедшего/);
  // Обе части полные — прежняя подпись.
  const closed = forecastAdditiveMetric(WEEK.slice(0, 7), FLAT, "2026-09-27");
  assert.match(forecastRatioMetric(closed, closed)!.method, /Завершённый период/);
});

// ── Сквозь buildMetrics: 29.09 — день без воронки ─────────────────────────────

const DAYS = ["2026-09-27", "2026-09-28", "2026-09-29"];
const row = (d: string, orders: number, ordersSum: number) => ({
  d,
  orders_count: orders,
  orders_sum: ordersSum,
  buyouts_count: 40,
  buyouts_sum: 12_000,
  ad_spent: 6_000,
  cancels_count: 1,
  cancels_sum: 500,
  orders_gross_sum: ordersSum * 2.5,
  orders_stat_sum: ordersSum,
  buyouts_gross_sum: 12_000,
  buyouts_finished_sum: 11_600,
  returns_count: 0,
  returns_sum: 0,
});
const CUTOFFS = { orders: "2026-09-29", sales: "2026-09-29", adverts: "2026-09-29", ordersPrimary: "2026-09-28" };
const find = (list: Metric[], field: string) => list.find((item) => item.field === field)!;

test("прогноз заказов периода не ниже показанного факта", () => {
  // Сегодня статистика уже знает 150 заказов — больше обычного дня.
  const byDate = new Map([
    ["2026-09-27", row("2026-09-27", 83, 64_770)],
    ["2026-09-28", row("2026-09-28", 110, 78_413)],
    ["2026-09-29", row("2026-09-29", 150, 120_000)],
  ]);
  const list = buildMetrics(DAYS, "2026-09-29", byDate, 100, 50_000, CUTOFFS, 0, null, 7, {});
  for (const field of ["orders_count", "orders_sum"]) {
    const metric = find(list, field);
    assert.ok((metric.forecast ?? 0) >= (metric.total ?? 0), `${field}: прогноз ${metric.forecast} < факт ${metric.total}`);
    assert.ok((metric.forecastLow ?? 0) >= (metric.total ?? 0), `${field}: низ вилки ${metric.forecastLow} < факт ${metric.total}`);
  }
  assert.doesNotMatch(find(list, "drr").forecastMethod ?? "", /Завершённый период/);
});

// ── Сводка = сумма своих артикулов ────────────────────────────────────────────

const PERIOD = ["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"];
const skuRows = (orders: number[]) => new Map(PERIOD.map((d, i) => [d, row(d, orders[i], orders[i] * 750)]));
const sumRows = (list: number[][]) => skuRows(PERIOD.map((_, i) => list.reduce((acc, orders) => acc + orders[i], 0)));

test("прогноз заказов сводки — не ниже суммы артикулов, фильтр не больше целого", () => {
  // У P сегодня всплеск (30 при обычных 8), у Q провал (6 при обычных 22).
  const series = { P: [8, 8, 9, 7, 8, 8, 8, 30], Q: [22, 21, 23, 22, 22, 21, 23, 6], R: [1, 1, 1, 1, 1, 1, 1, 0] };
  const skus = Object.values(series).map((orders) => ({
    metrics: buildMetrics(PERIOD, "2026-09-29", skuRows(orders), 0, 0, CUTOFFS, 0, null, 7, {}),
  }));
  const summary = buildMetrics(PERIOD, "2026-09-29", sumRows(Object.values(series)), 0, 0, CUTOFFS, 0, null, 7, {});
  applyMetricForecasts(summary, PERIOD, "2026-09-29", { orders_count: "2026-09-28", orders_sum: "2026-09-28" }, skuForecastFloors(skus));
  for (const field of ["orders_count", "orders_sum"]) {
    const whole = find(summary, field);
    const skuSum = skus.reduce((acc, sku) => acc + (find(sku.metrics, field).forecast ?? 0), 0);
    assert.ok(Math.abs((whole.forecast ?? 0) - skuSum) <= 1, `${field}: сводка ${whole.forecast} против суммы строк ${skuSum}`);
    assert.ok((whole.forecastHigh ?? 0) >= skuSum - 1);
    const subset = composeRnpSummaryFromSkus(summary, skus.slice(0, 2), 7);
    assert.ok((find(subset, field).forecast ?? 0) <= (whole.forecast ?? 0), `${field}: часть артикулов прогнозирует больше целого`);
  }
  // ДРР прогнозируется от тех же поднятых заказов, что стоят в строке.
  const drr = find(summary, "drr");
  const expected = Math.round(((find(summary, "ad_spent").forecast ?? 0) / (find(summary, "orders_sum").forecast ?? 1)) * 1000) / 10;
  assert.ok(Math.abs((drr.forecast ?? 0) - expected) <= 0.1, `ДРР ${drr.forecast} против ${expected}`);
});

test("без незакрытого дня сумма артикулов сводку не трогает", () => {
  const series = [[8, 8, 9, 7, 8, 8, 8, 9], [22, 21, 23, 22, 22, 21, 23, 20]];
  const skus = series.map((orders) => ({ metrics: buildMetrics(PERIOD, "2026-09-29", skuRows(orders), 0, 0, { ...CUTOFFS, ordersPrimary: "2026-09-29" }, 0, null, 7, {}) }));
  const plain = buildMetrics(PERIOD, "2026-09-29", sumRows(series), 0, 0, { ...CUTOFFS, ordersPrimary: "2026-09-29" }, 0, null, 7, {});
  const floored = buildMetrics(PERIOD, "2026-09-29", sumRows(series), 0, 0, { ...CUTOFFS, ordersPrimary: "2026-09-29" }, 0, null, 7, {});
  applyMetricForecasts(plain, PERIOD, "2026-09-29", {});
  applyMetricForecasts(floored, PERIOD, "2026-09-29", {}, skuForecastFloors(skus));
  assert.deepEqual(find(floored, "orders_count"), find(plain, "orders_count"));
});
