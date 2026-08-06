import assert from "node:assert/strict";
import test from "node:test";
import { deriveArticleBreakdown, sumBreakdowns } from "@/lib/opiu/unitEconomics";

test("§6: полная разбивка — удержания и прибыль считаются честно", () => {
  const b = deriveArticleBreakdown({ revenue: 100_000, forecastPayout: 70_000, planBuyouts: 50, costPerUnit: 800 });
  assert.equal(b.revenue, 100_000);
  assert.equal(b.withholdings, 30_000);   // 100000 − 70000
  assert.equal(b.payout, 70_000);
  assert.equal(b.cost, 40_000);           // 50 × 800
  assert.equal(b.profit, 30_000);         // 70000 − 40000
});

test("§6/§19: себестоимость влияет на прибыль, но не на выплату/удержания", () => {
  const withCost = deriveArticleBreakdown({ revenue: 100_000, forecastPayout: 70_000, planBuyouts: 50, costPerUnit: 800 });
  const noCost = deriveArticleBreakdown({ revenue: 100_000, forecastPayout: 70_000, planBuyouts: 50, costPerUnit: null });
  assert.equal(withCost.payout, noCost.payout);
  assert.equal(withCost.withholdings, noCost.withholdings);
  assert.equal(noCost.cost, null);
  assert.equal(noCost.profit, null); // без себестоимости прибыль не показывается (не ноль)
});

test("§19: нет выплаты → удержания и прибыль null, не ноль", () => {
  const b = deriveArticleBreakdown({ revenue: 100_000, forecastPayout: null, planBuyouts: 50, costPerUnit: 800 });
  assert.equal(b.payout, null);
  assert.equal(b.withholdings, null);
  assert.equal(b.profit, null);
  assert.equal(b.cost, 40_000); // себестоимость известна независимо
});

test("§6: суммирование помечает неполный итог, если у части нет данных", () => {
  const totals = sumBreakdowns([
    deriveArticleBreakdown({ revenue: 100_000, forecastPayout: 70_000, planBuyouts: 50, costPerUnit: 800 }),
    deriveArticleBreakdown({ revenue: 50_000, forecastPayout: 30_000, planBuyouts: 20, costPerUnit: null }),
    deriveArticleBreakdown({ revenue: 20_000, forecastPayout: null, planBuyouts: 10, costPerUnit: 500 }),
  ]);
  assert.equal(totals.revenue, 170_000);
  assert.equal(totals.payout, 100_000);       // 70000 + 30000 (третий без выплаты не в сумме)
  assert.equal(totals.withholdings, 50_000);  // 30000 + 20000
  assert.equal(totals.cost, 45_000);          // 40000 + 5000 (10×500)
  assert.equal(totals.costComplete, false);   // второй без себестоимости
  assert.equal(totals.payoutComplete, false); // третий без выплаты
});

test("§6: полный набор → итог помечен полным", () => {
  const totals = sumBreakdowns([
    deriveArticleBreakdown({ revenue: 100_000, forecastPayout: 70_000, planBuyouts: 50, costPerUnit: 800 }),
    deriveArticleBreakdown({ revenue: 50_000, forecastPayout: 35_000, planBuyouts: 25, costPerUnit: 600 }),
  ]);
  assert.equal(totals.costComplete, true);
  assert.equal(totals.payoutComplete, true);
  assert.equal(totals.profit, 30_000 + (35_000 - 15_000)); // 30000 + 20000
});
