import assert from "node:assert/strict";
import test from "node:test";

import { appendOrderConversion, buildFunnelMetrics, type Metric } from "./buildTable";

test("конверсия в корзину: пустой день источника не считается нулём", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const metrics = buildFunnelMetrics(
    days,
    "2026-08-03",
    new Map(),
    new Map(),
    new Map([["2026-08-01", 200], ["2026-08-03", 100]]),   // переходы
    new Map([["2026-08-01", 50], ["2026-08-03", 25]]),     // корзины
    { adverts: "2026-08-03", funnel: "2026-08-03" } as never,
  );
  const cartCr = metrics.find((metric) => metric.field === "cart_cr");
  assert.ok(cartCr);
  assert.equal(cartCr!.kind, "pct");
  assert.equal(cartCr!.daily[0], 25);   // 50/200
  assert.equal(cartCr!.daily[1], null); // нет данных — не ноль
  assert.equal(cartCr!.daily[2], 25);   // 25/100
  // Итог считается по суммам, а не как среднее дневных.
  assert.equal(cartCr!.total, 25);
});

test("конверсия в корзину не делится на ноль переходов", () => {
  const days = ["2026-08-01"];
  const metrics = buildFunnelMetrics(
    days, "2026-08-01",
    new Map(), new Map(),
    new Map([["2026-08-01", 0]]),
    new Map([["2026-08-01", 0]]),
    { adverts: "2026-08-01", funnel: "2026-08-01" } as never,
  );
  assert.equal(metrics.find((metric) => metric.field === "cart_cr")!.daily[0], null);
});

function metric(field: string, daily: Array<number | null>, total: number | null, coveragePct = 100): Metric {
  return { field, label: field, kind: "int", daily, total, forecast: null, coveragePct };
}

test("конверсия в заказ считается после слияния воронки и заказов", () => {
  const metrics: Metric[] = [
    metric("open_card", [200, null, 100], 300),
    metric("cart_cr", [25, null, 25], 25),
    metric("orders_count", [20, 5, 10], 30),
  ];
  appendOrderConversion(metrics);
  const orderCr = metrics.find((item) => item.field === "order_cr");
  assert.ok(orderCr);
  assert.equal(orderCr!.daily[0], 10);   // 20/200
  assert.equal(orderCr!.daily[1], null); // нет переходов — не ноль
  assert.equal(orderCr!.daily[2], 10);   // 10/100
  assert.equal(orderCr!.total, 10);      // 30/300, по суммам
  // Встаёт сразу после конверсии в корзину.
  assert.equal(metrics.findIndex((item) => item.field === "order_cr"), 2);
});

test("конверсия в заказ берёт покрытие по слабейшему источнику", () => {
  const metrics: Metric[] = [
    metric("open_card", [100], 100, 40),
    metric("orders_count", [10], 10, 90),
  ];
  appendOrderConversion(metrics);
  assert.equal(metrics.find((item) => item.field === "order_cr")!.coveragePct, 40);
});

test("конверсия в заказ не дублируется и молчит без источника", () => {
  const twice: Metric[] = [metric("open_card", [100], 100), metric("orders_count", [10], 10)];
  appendOrderConversion(twice);
  appendOrderConversion(twice);
  assert.equal(twice.filter((item) => item.field === "order_cr").length, 1);
  const noFunnel: Metric[] = [metric("orders_count", [10], 10)];
  appendOrderConversion(noFunnel);
  assert.equal(noFunnel.some((item) => item.field === "order_cr"), false);
});
