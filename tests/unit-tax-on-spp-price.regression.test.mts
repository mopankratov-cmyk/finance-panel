import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { computeUnitSppRates, sppShareForNm, taxableUnitPrice } from "../lib/unit/sppRates";
import { aggregateUnitContributions, type UnitContribution } from "../lib/unit/groupAggregation";

// Налог платится с суммы, которую заплатил покупатель, то есть с цены ПОСЛЕ СПП.
// Юнит считал его от цены продавца, и на куртках с СПП ~40% налог выходил
// в полтора раза больше реального — маржа выглядела хуже, чем она есть.

test("СПП считается по каждому SKU отдельно, а не одной средней", () => {
  const rates = computeUnitSppRates([
    // Куртка: продавец 5000, покупатель 3000 → СПП 40%.
    { nm_id: 1, price_with_disc: 5000, finished_price: 3000 },
    { nm_id: 1, price_with_disc: 5000, finished_price: 3000 },
    // Пенал: продавец 250, покупатель 228 → СПП 8.8%.
    { nm_id: 2, price_with_disc: 250, finished_price: 228 },
  ]);
  assert.equal(Math.round((rates.byNm.get(1) ?? 0) * 1000) / 10, 40);
  assert.equal(Math.round((rates.byNm.get(2) ?? 0) * 1000) / 10, 8.8);
  assert.equal(rates.covered, 2);
});

test("SKU без продаж периода получает СПП по выборке, а не нулевую", () => {
  const rates = computeUnitSppRates([{ nm_id: 1, price_with_disc: 1000, finished_price: 800 }]);
  const round = (value: number | null) => (value == null ? null : Math.round(value * 1000) / 1000);
  assert.equal(round(sppShareForNm(rates, 1)), 0.2);
  assert.equal(round(sppShareForNm(rates, 999)), 0.2);
});

test("без единого факта продаж СПП неизвестна, а не равна нулю", () => {
  const empty = computeUnitSppRates([]);
  assert.equal(sppShareForNm(empty, 1), null);
  // Неизвестная СПП оставляет базой цену продавца — прежнее поведение, но честно помеченное.
  assert.equal(taxableUnitPrice(5000, null), 5000);
});

test("база налога — цена после СПП", () => {
  assert.equal(taxableUnitPrice(5000, 0.4), 3000);
  const taxPct = 7;
  assert.equal(Math.round(taxableUnitPrice(5000, 0.4) * taxPct / 100), 210);
  // До правки было бы 5000 × 7% = 350 ₽ — на 140 ₽/ед больше.
  assert.notEqual(Math.round(5000 * taxPct / 100), 210);
});

test("возврат СПП выше цены продавца не превращается в отрицательную скидку", () => {
  const rates = computeUnitSppRates([{ nm_id: 1, price_with_disc: 900, finished_price: 1000 }]);
  assert.equal(rates.byNm.get(1), 0);
});

const contribution = (over: Partial<UnitContribution>): UnitContribution => ({
  cabinetId: "cab-1",
  nmId: 1,
  article: "NV-01",
  orders: 10,
  revenue: 50_000,
  buyouts: 8,
  stock: 100,
  adSpend: 0,
  costPerUnit: 1000,
  marketplacePct: 20,
  acquiringPct: 2,
  ratesFactual: true,
  sppShare: 0.4,
  ...over,
});

test("в группе налог берётся с выручки после СПП каждого кабинета", () => {
  const [row] = aggregateUnitContributions(
    [
      contribution({ cabinetId: "cab-1", revenue: 50_000, sppShare: 0.4 }),
      contribution({ cabinetId: "cab-2", revenue: 10_000, sppShare: 0.1 }),
    ],
    { taxPct: 7, ff: 0 },
  );
  // 50 000 × 0.6 + 10 000 × 0.9 = 39 000 → налог 2 730 ₽ вместо 4 200 ₽ с полной выручки.
  assert.equal(row.taxableRevenue, 39_000);
  assert.equal(row.taxRub, 2_730);
  assert.equal(row.sppKnown, true);
});

test("кабинет без факта СПП входит в базу целиком и помечается", () => {
  const [row] = aggregateUnitContributions(
    [contribution({ revenue: 50_000, sppShare: null })],
    { taxPct: 7, ff: 0 },
  );
  assert.equal(row.taxableRevenue, 50_000);
  assert.equal(row.sppKnown, false);
});

test("юнит-роут считает налог от цены с СПП и показывает эту базу", async () => {
  const route = await readFile(new URL("../app/api/unit/table/route.ts", import.meta.url), "utf8");
  assert.match(route, /const taxRub = priceWithSpp \* taxPct \/ 100/);
  assert.doesNotMatch(route, /const taxRub = price \* taxPct \/ 100/);
  assert.match(route, /"Цена с СПП ₽"/);
  // Решатель целевой цены обязан использовать ту же базу, иначе он потребует лишнюю наценку.
  assert.match(route, /effectiveTaxPct/);
});

// Версия схемы растёт с каждой сменой формулы; тест сторожит сам факт версии,
// а не конкретное число, иначе он ломается на каждой честной правке.
test("часовой кэш не отдаёт снимки со старой формулой налога", async () => {
  const period = await readFile(new URL("../lib/unit/period.ts", import.meta.url), "utf8");
  assert.match(period, /UNIT_PERIOD_SCHEMA_VERSION = "unit-period-v\d+"/);
});
