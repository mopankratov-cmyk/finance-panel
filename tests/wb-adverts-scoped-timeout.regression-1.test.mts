import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { advertMonthStart, buildScopedAdvertReportRowsFromFacts } from "../lib/adverts/scopedReport";

test("WB adverts scoped report aggregates only allowlisted SKU", () => {
  const rows = buildScopedAdvertReportRowsFromFacts({
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
  });

  assert.deepEqual(rows, [
    {
      nm_id: 101,
      article: "NOR-101",
      orders_month: 1,
      orders_sum_month: 900,
      stock: 5,
      in_way_to_client: 0,
      cost: 100,
    },
    {
      nm_id: 202,
      article: "RIO-202",
      orders_month: 0,
      orders_sum_month: 0,
      stock: 0,
      in_way_to_client: 0,
      cost: 250,
    },
  ]);
});

test("WB adverts month start uses the same 30-day window shape as rnp_report", () => {
  assert.equal(advertMonthStart(new Date("2026-07-15T12:00:00.000Z")), "2026-06-16");
});

test("WB adverts route does not let live WB balance hold the page for 45 seconds", () => {
  const source = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");
  assert.match(source, /signal:\s*AbortSignal\.timeout\(5_000\)/);
  assert.match(source, /loadScopedAdvertReportRows\(db,\s*cabinetId,\s*\[\.\.\.allowedNmIds\]\)/);
});
