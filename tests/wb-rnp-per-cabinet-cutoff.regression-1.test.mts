import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFunnelOrdersOverlay,
  applyRnpScopeCutoff,
  applyRnpSourceCutoffs,
  applySalesReturnsAdjustment,
  moscowDateFromIso,
  sourceCutoffFromSyncState,
} from "../lib/rnp/buildTable";

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

test("WB RNP subtracts return quantity and amount from buyouts", () => {
  const [row] = applySalesReturnsAdjustment([
    { nm_id: 7, d: "2026-07-20", orders_count: 20, orders_sum: 120_000, buyouts_count: 12, buyouts_sum: 80_000, ad_spent: 3_000 },
  ], [
    { nm_id: 7, date: "2026-07-20T12:00:00.000Z", price_with_disc: -6_400, finished_price: -5_200, sale_id: "R-return-1" },
    { nm_id: 7, date: "2026-07-20T13:00:00.000Z", price_with_disc: 6_200, finished_price: 5_000, sale_id: "R-return-2" },
  ]);

  assert.deepEqual(row, {
    nm_id: 7,
    d: "2026-07-20",
    orders_count: 20,
    orders_sum: 120_000,
    buyouts_count: 10,
    buyouts_sum: 67_400,
    ad_spent: 3_000,
  });
});

test("WB RNP creates a negative net-buyout row when a day contains only a return", () => {
  const [row] = applySalesReturnsAdjustment([], [
    { nm_id: 8, date: "2026-07-21T09:00:00.000Z", price_with_disc: -4_500, finished_price: -4_000, sale_id: "R-return-only" },
  ]);

  assert.deepEqual(row, {
    nm_id: 8,
    d: "2026-07-21",
    orders_count: 0,
    orders_sum: 0,
    buyouts_count: -1,
    buyouts_sum: -4_500,
    ad_spent: 0,
  });
});

test("WB RNP treats a caught-up sync as fresh even when a day has no activity rows", () => {
  const state = {
    cursor: null,
    status: "caught_up",
    attempts: 0,
    lastError: null,
    updatedAt: "2026-07-20T21:10:00.000Z",
    state: { coveragePct: 100, lastSyncedAt: "2026-07-20T21:10:00.000Z" },
  };

  assert.equal(moscowDateFromIso(state.state.lastSyncedAt), "2026-07-21");
  assert.equal(sourceCutoffFromSyncState(state, "2026-07-31"), "2026-07-21");
});

test("WB RNP uses funnel completed period instead of sync wall-clock time", () => {
  const state = {
    cursor: "0",
    status: "caught_up",
    attempts: 0,
    lastError: null,
    updatedAt: "2026-07-21T20:10:00.000Z",
    state: {
      coveragePct: 100,
      lastSyncedAt: "2026-07-21T20:10:00.000Z",
      lastPeriod: { begin: "2026-07-20", end: "2026-07-20", mode: "yesterday" },
    },
  };

  assert.equal(sourceCutoffFromSyncState(state, "2026-07-31", { preferLastPeriodEnd: true }), "2026-07-20");
});
