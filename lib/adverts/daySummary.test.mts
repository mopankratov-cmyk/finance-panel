import assert from "node:assert/strict";
import test from "node:test";

import { buildAdvertWorkingDaySummary } from "./daySummary";

test("advert working day summary separates campaign attribution from SKU funnel facts", () => {
  const summary = buildAdvertWorkingDaySummary({
    date: "2026-07-25",
    isComplete: true,
    statsSyncedAt: "2026-07-25T23:59:59.999Z",
    statsAgeHours: 2.4,
    adDay: {
      ts: "2026-07-25",
      views: 10_000,
      clicks: 250,
      spend: 5_000,
      orders: 50_000,
    },
    funnel: {
      openCard: 3_000,
      carts: 300,
      ordersCount: 42,
      ordersSum: 61_000,
    },
  });

  assert.deepEqual(summary, {
    date: "2026-07-25",
    is_complete: true,
    views: 10_000,
    clicks: 250,
    ctr: 2.5,
    spend: 5_000,
    attributed_revenue: 50_000,
    attributed_drr: 10,
    open_card: 3_000,
    carts: 300,
    orders_count: 42,
    orders_sum: 61_000,
    stats_synced_at: "2026-07-25T23:59:59.999Z",
    stats_age_hours: 2.4,
  });
});

test("advert working day summary is safe when one source is missing", () => {
  const summary = buildAdvertWorkingDaySummary({
    date: "2026-07-26",
    isComplete: false,
    statsSyncedAt: null,
    statsAgeHours: null,
    adDay: null,
    funnel: { openCard: 10, carts: 2, ordersCount: 1, ordersSum: 250 },
  });

  assert.equal(summary.is_complete, false);
  assert.equal(summary.views, null);
  assert.equal(summary.spend, null);
  assert.equal(summary.attributed_drr, null);
  assert.equal(summary.orders_count, 1);
  assert.equal(summary.orders_sum, 250);
});
