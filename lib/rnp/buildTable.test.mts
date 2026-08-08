import assert from "node:assert/strict";
import test from "node:test";

import { buildFunnelMetrics } from "./buildTable";

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
