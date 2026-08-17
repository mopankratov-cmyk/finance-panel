import assert from "node:assert/strict";
import test from "node:test";

import { appendTaxMetrics } from "../lib/rnp/taxMetrics";
import type { Metric } from "../lib/rnp/buildTable";

// Налог в РНП — с цены покупателя (выкупы минус СПП дня), как в юнитке после #406.
// Комиссия кабинета (посредник) — с цены продавца, уменьшает чистую прибыль.

const metric = (field: string, daily: Array<number | null>, total: number | null): Metric => ({
  field, label: field, kind: "money", daily, total, forecast: null, source: "тест", coveragePct: 100,
});

test("база налога — выкупы за вычетом СПП дня", () => {
  const metrics: Metric[] = [
    metric("buyouts_sum", [10_000, 10_000], 20_000),
    metric("gross", [3_000, 3_000], 6_000),
    metric("spp_pct", [40, 10], null),
  ];
  appendTaxMetrics(metrics, 7);
  const tax = metrics.find((item) => item.field === "tax_rub");
  // 10 000×0.6×7% = 420; 10 000×0.9×7% = 630.
  assert.deepEqual(tax?.daily, [420, 630]);
  assert.equal(tax?.total, 1_050);
});

test("день без известной СПП считается от цены продавца", () => {
  const metrics: Metric[] = [
    metric("buyouts_sum", [10_000, 10_000], 20_000),
    metric("gross", [3_000, 3_000], 6_000),
    metric("spp_pct", [40, null], null),
  ];
  appendTaxMetrics(metrics, 7);
  const tax = metrics.find((item) => item.field === "tax_rub");
  assert.deepEqual(tax?.daily, [420, 700]);
  assert.equal(tax?.total, 1_120);
});

test("без метрики СПП поведение прежнее — от цены продавца", () => {
  const metrics: Metric[] = [
    metric("buyouts_sum", [10_000], 10_000),
    metric("gross", [3_000], 3_000),
  ];
  appendTaxMetrics(metrics, 7);
  assert.deepEqual(metrics.find((item) => item.field === "tax_rub")?.daily, [700]);
});

test("комиссия кабинета уменьшает чистую прибыль и видна строкой", () => {
  const metrics: Metric[] = [
    metric("buyouts_sum", [10_000], 10_000),
    metric("gross", [3_000], 3_000),
    metric("spp_pct", [0], null),
  ];
  appendTaxMetrics(metrics, 7, { extraCommissionPct: 5 });
  const agent = metrics.find((item) => item.field === "agent_commission_rub");
  const net = metrics.find((item) => item.field === "net_profit");
  assert.deepEqual(agent?.daily, [500]);
  // 3 000 − 700 (налог) − 500 (комиссия) = 1 800.
  assert.deepEqual(net?.daily, [1_800]);
  assert.equal(net?.total, 1_800);
});

test("без настройки комиссии строка не появляется, прибыль прежняя", () => {
  const metrics: Metric[] = [
    metric("buyouts_sum", [10_000], 10_000),
    metric("gross", [3_000], 3_000),
  ];
  appendTaxMetrics(metrics, 7);
  assert.equal(metrics.some((item) => item.field === "agent_commission_rub"), false);
  assert.deepEqual(metrics.find((item) => item.field === "net_profit")?.daily, [2_300]);
});
