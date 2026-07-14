import assert from "node:assert/strict";
import test from "node:test";
import { buildScopedBaseFactsFromRows } from "../lib/rnp/buildTable";

test("scoped RNP base facts aggregate only allowlisted SKU without full-cabinet RPC", () => {
  const result = buildScopedBaseFactsFromRows({
    allowedNmIds: [101, 202],
    products: [
      { nm_id: 101, article: "NOR-101" },
      { nm_id: 202, article: "RIO-202" },
    ],
    costs: [
      { article: "NOR-101", name: "Norvia", cost_rub: 100 },
      { article: "RIO-202", name: "Riobox", cost_rub: 250 },
      { article: "OTHER-999", name: "Other", cost_rub: 1 },
    ],
    stocks: [
      { nm_id: 101, quantity: 3 },
      { nm_id: 101, quantity: 2 },
      { nm_id: 202, quantity: 0 },
      { nm_id: 999, quantity: 99 },
    ],
    orders: [
      { nm_id: 101, supplier_article: "NOR-101", date: "2026-07-14T10:00:00.000Z", total_price: 1000, discount_percent: 10, is_cancel: false },
      { nm_id: 101, supplier_article: "NOR-101", date: "2026-07-14T11:00:00.000Z", total_price: 500, discount_percent: 0, is_cancel: true },
      { nm_id: 999, supplier_article: "OTHER-999", date: "2026-07-14T12:00:00.000Z", total_price: 9999, discount_percent: 0, is_cancel: false },
    ],
    sales: [
      { nm_id: 101, date: "2026-07-14T15:00:00.000Z", price_with_disc: 880, finished_price: 700, sale_id: "S123" },
      { nm_id: 101, date: "2026-07-14T16:00:00.000Z", price_with_disc: 100, finished_price: 100, sale_id: "R123" },
      { nm_id: 999, date: "2026-07-14T17:00:00.000Z", price_with_disc: 9999, finished_price: 9999, sale_id: "S999" },
    ],
    advertSpend: [
      { nm_id: 101, date: "2026-07-14", spent: 77 },
      { nm_id: 999, date: "2026-07-14", spent: 999 },
    ],
  });

  assert.deepEqual(result.totals, [
    { nm_id: 101, article: "NOR-101", stock: 5, cost: 100 },
    { nm_id: 202, article: "RIO-202", stock: 0, cost: 250 },
  ]);
  assert.equal(result.skuRows.length, 1);
  assert.deepEqual(result.skuRows[0], {
    d: "2026-07-14",
    nm_id: 101,
    orders_count: 1,
    orders_sum: 900,
    buyouts_count: 1,
    buyouts_sum: 880,
    ad_spent: 77,
  });
});
