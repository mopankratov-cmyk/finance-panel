import assert from "node:assert/strict";
import test from "node:test";
import {
  requireCompleteOzonSalesSnapshot,
  summarizeOzonSales,
} from "../lib/ozon/cockpitQuality";
import { ozonCockpitRevalidationProfile } from "../lib/ozon/cockpitCache";

// Regression: ISSUE-001 — Ozon all cached sales from only the first cabinet
// Found by /qa on 2026-07-14
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-14.md
test("Ozon overview all equals the sum of every selected cabinet", () => {
  const totals = summarizeOzonSales([
    { orders: 568, revenue: 891_829, previousOrders: 500, previousRevenue: 800_000 },
    { orders: 350, revenue: 1_476_544, previousOrders: 300, previousRevenue: 1_200_000 },
  ]);

  assert.deepEqual(totals, {
    orders: 918,
    revenue: 2_368_373,
    previousOrders: 800,
    previousRevenue: 2_000_000,
  });
});

test("Ozon overview refuses to replace cache with a partial cabinet snapshot", () => {
  assert.throws(
    () => requireCompleteOzonSalesSnapshot([
      { cabinet: "Ozon COSMOS", available: true },
      { cabinet: "Ozon 1933484", available: false, error: "Ozon 429" },
    ]),
    /Неполный снимок продаж Ozon: Ozon 1933484 \(Ozon 429\)/,
  );
});

test("hourly Ozon warmup uses stale-while-revalidate instead of expiring the good snapshot", () => {
  assert.equal(ozonCockpitRevalidationProfile({ backgroundRefresh: true }), "max");
  assert.deepEqual(ozonCockpitRevalidationProfile({ forceRefresh: true }), { expire: 0 });
  assert.equal(ozonCockpitRevalidationProfile({}), null);
});
