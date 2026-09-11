import assert from "node:assert/strict";
import test from "node:test";
import { monthlyWbActualFromOpiu } from "./monthlyWbActual.ts";

const values: Record<string, number | null> = {
  revenue_without_spp: 1_000,
  revenue: 900,
  commission: 120,
  logistics: 80,
  cogs: 300,
  packaging: 25,
  warehouse: 15,
  penalties: 10,
  ads: 50,
  other: 7,
  jem: 3,
  withdraw_now: 4,
  transit: 5,
  acceptance: 6,
  gross: 375,
  gross_pct: 41.7,
  loyalty_comp: 12,
  for_pay: 680,
};

test("месячный факт WB берёт реальные удержания из финансового отчёта", () => {
  const actual = monthlyWbActualFromOpiu({
    report: {
      weeks: [],
      rows: Object.entries(values).map(([id, value]) => ({ id, label: id, kind: id.endsWith("pct") ? "percent" : "metric", values: [value] })),
      warehouseByWeek: {},
      missingCostArticles: [{ article: "SKU-1", qty: 2, revenue: 500 }],
    },
    timestamp: "2026-09-11T12:00:00.000Z",
    meta: { salesRows: 42 },
  });

  assert.equal(actual.logistics, 80);
  assert.equal(actual.storage, 15);
  assert.equal(actual.penalty, 10);
  assert.equal(actual.packaging, 25);
  assert.equal(actual.other, 25);
  assert.equal(actual.rowsCount, 42);
  assert.match(actual.warnings[0]!, /себестоимость/);
});

test("отсутствующая обязательная строка не превращается в ноль", () => {
  assert.throws(() => monthlyWbActualFromOpiu({
    report: { weeks: [], rows: [], warehouseByWeek: {}, missingCostArticles: [] },
    timestamp: "2026-09-11T12:00:00.000Z",
    meta: { salesRows: 0 },
  }), /не содержит строку/);
});
