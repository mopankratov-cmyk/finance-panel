import assert from "node:assert/strict";
import test from "node:test";
import { applyFunnelOrdersOverlay, applyRnpScopeCutoff, applyRnpSourceCutoffs } from "../lib/rnp/buildTable";

type Row = {
  nm_id: number;
  d: string;
  orders_count: number;
  orders_sum: number;
  buyouts_count: number;
  buyouts_sum: number;
  ad_spent: number;
};

const sumOrders = (rows: Row[]) => rows.reduce((total, row) => total + row.orders_count, 0);

// Regression: ISSUE-002 — WB RNP all included Optima orders after its complete as_of
// Found by /qa on 2026-07-14
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-14.md
test("WB RNP all aggregates each cabinet only through its own complete date", () => {
  const optima = applyRnpScopeCutoff<Row>([
    { nm_id: 1, d: "2026-07-12", orders_count: 35, orders_sum: 39_157, buyouts_count: 19, buyouts_sum: 7_128, ad_spent: 1_000 },
    { nm_id: 1, d: "2026-07-13", orders_count: 100, orders_sum: 70_000, buyouts_count: 0, buyouts_sum: 0, ad_spent: 500 },
    { nm_id: 1, d: "2026-07-14", orders_count: 118, orders_sum: 81_079, buyouts_count: 0, buyouts_sum: 0, ad_spent: 700 },
  ], "2026-07-12");
  const freshCabinet = applyRnpScopeCutoff<Row>([
    { nm_id: 2, d: "2026-07-12", orders_count: 900, orders_sum: 1_900_000, buyouts_count: 850, buyouts_sum: 1_700_000, ad_spent: 100_000 },
    { nm_id: 2, d: "2026-07-13", orders_count: 1_000, orders_sum: 2_100_000, buyouts_count: 950, buyouts_sum: 1_900_000, ad_spent: 110_000 },
    { nm_id: 2, d: "2026-07-14", orders_count: 1_085, orders_sum: 2_320_789, buyouts_count: 1_059, buyouts_sum: 2_100_000, ad_spent: 120_000 },
  ], "2026-07-14");

  assert.equal(sumOrders(optima), 35);
  assert.equal(sumOrders(freshCabinet), 2_985);
  assert.equal(sumOrders([...optima, ...freshCabinet]), 3_020);
});

test("rows after a cabinet cutoff contribute neither orders nor downstream metrics", () => {
  const [row] = applyRnpScopeCutoff<Row>([
    { nm_id: 7, d: "2026-07-14", orders_count: 218, orders_sum: 151_079, buyouts_count: 12, buyouts_sum: 8_000, ad_spent: 3_000 },
  ], "2026-07-12");

  assert.deepEqual(row, {
    nm_id: 7,
    d: "2026-07-14",
    orders_count: 0,
    orders_sum: 0,
    buyouts_count: 0,
    buyouts_sum: 0,
    ad_spent: 0,
  });
});

test("WB RNP keeps fresh orders when sales source lags behind", () => {
  const [row] = applyRnpSourceCutoffs<Row>([
    { nm_id: 7, d: "2026-07-20", orders_count: 218, orders_sum: 151_079, buyouts_count: 12, buyouts_sum: 8_000, ad_spent: 3_000 },
  ], { orders: "2026-07-20", sales: "2026-07-19", adverts: "2026-07-20" });

  assert.deepEqual(row, {
    nm_id: 7,
    d: "2026-07-20",
    orders_count: 218,
    orders_sum: 151_079,
    buyouts_count: 0,
    buyouts_sum: 0,
    ad_spent: 3_000,
  });
});

test("WB RNP prefers WB funnel order totals over supplier order events", () => {
  const [row] = applyFunnelOrdersOverlay([
    { nm_id: 7, d: "2026-07-20", orders_count: 218, orders_sum: 151_079, buyouts_count: 12, buyouts_sum: 8_000, ad_spent: 3_000 },
  ], [
    { nm_id: 7, date: "2026-07-20", open_card: 0, add_to_cart: 0, orders: 451, orders_sum: 298_742 },
  ]);

  assert.deepEqual(row, {
    nm_id: 7,
    d: "2026-07-20",
    orders_count: 451,
    orders_sum: 298_742,
    buyouts_count: 12,
    buyouts_sum: 8_000,
    ad_spent: 3_000,
  });
});

test("WB RNP creates a daily order row from WB funnel when supplier events are missing", () => {
  const [row] = applyFunnelOrdersOverlay([], [
    { nm_id: 8, date: "2026-07-20", open_card: 0, add_to_cart: 0, orders: 37, orders_sum: 21_990 },
  ]);

  assert.deepEqual(row, {
    nm_id: 8,
    d: "2026-07-20",
    orders_count: 37,
    orders_sum: 21_990,
    buyouts_count: 0,
    buyouts_sum: 0,
    ad_spent: 0,
  });
});
