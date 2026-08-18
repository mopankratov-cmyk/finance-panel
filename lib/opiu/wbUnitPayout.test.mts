import assert from "node:assert/strict";
import test from "node:test";
import { resolveWbPayoutRate } from "@/lib/opiu/wbUnitPayout";

test("WB forecast prefers a valid financial-report payout share", () => {
  assert.deepEqual(resolveWbPayoutRate({
    historicalRevenue: 100_000, historicalPayout: 62_000,
    unitMarketplacePct: 20, unitAcquiringPct: 2, unitRatesAvailable: true,
  }), { rate: 0.62, source: "financial_report" });
});

test("WB forecast falls back to unit economics when report history is absent", () => {
  assert.deepEqual(resolveWbPayoutRate({
    historicalRevenue: 0, historicalPayout: 0,
    unitMarketplacePct: 24, unitAcquiringPct: 2, unitRatesAvailable: true,
  }), { rate: 0.74, source: "unit_economics" });
});

test("WB forecast stays unavailable when neither source is complete", () => {
  assert.deepEqual(resolveWbPayoutRate({
    historicalRevenue: 0, historicalPayout: 0,
    unitMarketplacePct: null, unitAcquiringPct: 2, unitRatesAvailable: false,
  }), { rate: null, source: "unavailable" });
});

test("WB forecast rejects impossible report ratios and uses unit economics", () => {
  assert.deepEqual(resolveWbPayoutRate({
    historicalRevenue: 100, historicalPayout: 130,
    unitMarketplacePct: 20, unitAcquiringPct: 2, unitRatesAvailable: true,
  }), { rate: 0.78, source: "unit_economics" });
});
