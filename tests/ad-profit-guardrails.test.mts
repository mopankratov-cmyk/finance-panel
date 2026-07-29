import assert from "node:assert/strict";
import test from "node:test";
import { calculateAdvertProfitGuardrail, compareAdvertBeforeAfter } from "../lib/adverts/profitGuardrails";

test("advert guardrail calculates break-even DRR and profit after ads", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 15_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: 100,
    dailyUnits: 2,
    attributionCompatible: true,
    dataAgeHours: 1,
  });
  assert.equal(result.breakEvenDrr, 28);
  assert.equal(result.breakEvenRoas, 3.6);
  assert.equal(result.profitAfterAds, 13_000);
  assert.equal(result.action, "increase");
  assert.equal(result.confidence, "high");
});

test("advert guardrail fails closed without cost", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: null,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
  });
  assert.equal(result.profitAfterAds, null);
  assert.equal(result.breakEvenDrr, null);
  assert.equal(result.action, "insufficient");
});

test("advert guardrail fails closed without marketplace fees", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 0,
    acquiringPct: 0,
    extraPct: 0,
    taxPct: 7,
    feesComplete: false,
    stock: 100,
    dailyUnits: 2,
  });
  assert.equal(result.profitAfterAds, null);
  assert.equal(result.action, "insufficient");
});

test("advert guardrail does not scale without a known stock cover", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: null,
    dailyUnits: 2,
    attributionCompatible: true,
    dataAgeHours: 1,
  });
  assert.equal(result.daysCover, null);
  assert.equal(result.action, "hold");
});

test("advert guardrail does not scale on stale data", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: 100,
    dailyUnits: 2,
    attributionCompatible: true,
    dataAgeHours: 8,
  });
  assert.equal(result.confidence, "medium");
  assert.equal(result.action, "hold");
});

test("critical stock overrides an otherwise profitable scale recommendation", () => {
  const result = calculateAdvertProfitGuardrail({
    price: 1_000,
    cost: 400,
    revenue: 100_000,
    spent: 5_000,
    commissionPct: 20,
    acquiringPct: 2,
    extraPct: 3,
    taxPct: 7,
    stock: 5,
    dailyUnits: 1,
    attributionCompatible: true,
    dataAgeHours: 1,
  });
  assert.equal(result.stockRisk, "critical");
  assert.equal(result.action, "decrease");
  assert.equal(result.budgetChangePct, -30);
});

test("before and after comparison requires two days on each side", () => {
  const comparison = compareAdvertBeforeAfter([
    { date: "2026-07-01", spent: 100, revenue: 1_000 },
    { date: "2026-07-02", spent: 120, revenue: 1_000 },
    { date: "2026-07-03", spent: 80, revenue: 1_000 },
    { date: "2026-07-04", spent: 90, revenue: 1_000 },
  ], "2026-07-03T10:00:00.000Z");
  assert.ok(comparison);
  assert.equal(comparison.before.drr, 11);
  assert.equal(comparison.after.drr, 8.5);
  assert.equal(comparison.drrDelta, -2.5);
});
