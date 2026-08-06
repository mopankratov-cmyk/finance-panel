import assert from "node:assert/strict";
import test from "node:test";
import { classifyForecastArticleGaps } from "@/lib/opiu/forecastGaps";

test("§9: полный артикул без пробелов включён в итог", () => {
  const result = classifyForecastArticleGaps({ planRevenue: 100_000, payoutRate: 0.7 });
  assert.deepEqual(result.gaps, []);
  assert.equal(result.affectsPayout, false);
  assert.equal(result.includedInForecast, true);
});

test("§9: нет истории фин.отчётов → пробел выплаты, не включён в итог", () => {
  const result = classifyForecastArticleGaps({ planRevenue: 100_000, payoutRate: null });
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].impact, "payout");
  assert.equal(result.affectsPayout, true);
  assert.equal(result.includedInForecast, false);
});

test("§9: нет плановой выручки → пробел выплаты", () => {
  const result = classifyForecastArticleGaps({ planRevenue: 0, payoutRate: 0.7 });
  assert.equal(result.gaps.some((gap) => gap.field.startsWith("Плановая выручка")), true);
  assert.equal(result.affectsPayout, true);
  assert.equal(result.includedInForecast, false);
});

test("§6/§9: себестоимость влияет только на прибыль, выплата остаётся полной", () => {
  const result = classifyForecastArticleGaps({ planRevenue: 100_000, payoutRate: 0.7, cost: false });
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].impact, "profit");
  assert.equal(result.affectsPayout, false);
  assert.equal(result.includedInForecast, true);
});

test("§9: комиссия/логистика/хранение/эквайринг — пробелы выплаты", () => {
  const result = classifyForecastArticleGaps({
    planRevenue: 100_000, payoutRate: 0.7,
    commission: false, logistics: false, storage: false, acquiring: false,
  });
  assert.equal(result.gaps.length, 4);
  assert.equal(result.gaps.every((gap) => gap.impact === "payout"), true);
  assert.equal(result.affectsPayout, true);
});

test("§9: undefined-компоненты не считаются пробелом (фаза их не оценивает)", () => {
  const result = classifyForecastArticleGaps({ planRevenue: 100_000, payoutRate: 0.7 });
  // commission/logistics/... не переданы → не должны попасть в пробелы
  assert.equal(result.gaps.length, 0);
});

test("§9: несколько пробелов накапливаются и разделяются по влиянию", () => {
  const result = classifyForecastArticleGaps({ planRevenue: 0, payoutRate: null, cost: false });
  const payoutGaps = result.gaps.filter((gap) => gap.impact === "payout");
  const profitGaps = result.gaps.filter((gap) => gap.impact === "profit");
  assert.equal(payoutGaps.length, 2);
  assert.equal(profitGaps.length, 1);
  assert.equal(result.affectsPayout, true);
  assert.equal(result.includedInForecast, false);
});
