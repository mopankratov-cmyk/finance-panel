import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { campaignEconomicsBasis } from "../lib/adverts/campaignBasis";

/**
 * Экономика кампании считалась по ПЕРВОМУ артикулу из её списка, а ставка
 * налога была вбита числом 7. И то и другое превращало рекомендацию по ставке
 * в выдумку: у кампании на десять товаров расход общий, а налоговый режим у
 * каждого юрлица свой.
 */

test("цена и себестоимость взвешены по заказам всех товаров кампании", () => {
  const basis = campaignEconomicsBasis([
    { nm: 1, orders: 10, revenue: 10_000, cost: 300, stock: 5, commissionPct: 20, acquiringPct: 2, extraPct: 5 },
    { nm: 2, orders: 90, revenue: 45_000, cost: 100, stock: 45, commissionPct: 10, acquiringPct: 2, extraPct: 5 },
  ]);
  // Первый товар — 1000 ₽ за штуку, второй — 500 ₽. По первому в списке цена
  // была бы 1000 ₽, честная средняя по заказам — 550 ₽.
  assert.equal(basis.price, 550);
  assert.equal(basis.cost, 120, "себестоимость тоже по заказам: (300×10 + 100×90) / 100");
  assert.equal(basis.stock, 50);
  assert.equal(basis.skuCount, 2);
});

test("ставки удержаний взвешены по выручке — спящий SKU среднее не тянет", () => {
  const basis = campaignEconomicsBasis([
    { nm: 1, orders: 0, revenue: 0, cost: 300, stock: 0, commissionPct: 25, acquiringPct: 3, extraPct: 9 },
    { nm: 2, orders: 100, revenue: 50_000, cost: 100, stock: 10, commissionPct: 10, acquiringPct: 2, extraPct: 5 },
  ]);
  assert.equal(basis.commissionPct, 10);
  assert.equal(basis.acquiringPct, 2);
  assert.equal(basis.extraPct, 5);
});

test("себестоимость молчит, если её нет у продающегося товара кампании", () => {
  const basis = campaignEconomicsBasis([
    { nm: 1, orders: 50, revenue: 25_000, cost: 100, stock: 10, commissionPct: 10, acquiringPct: 2, extraPct: 5 },
    { nm: 2, orders: 50, revenue: 25_000, cost: null, stock: 10, commissionPct: 10, acquiringPct: 2, extraPct: 5 },
  ]);
  assert.equal(basis.cost, null, "половина затрат неизвестна — маржа кампании тоже");
  assert.equal(basis.costKnownCount, 1);
});

test("товар без заказов не мешает считать себестоимость по остальным", () => {
  const basis = campaignEconomicsBasis([
    { nm: 1, orders: 50, revenue: 25_000, cost: 100, stock: 10, commissionPct: 10, acquiringPct: 2, extraPct: 5 },
    { nm: 2, orders: 0, revenue: 0, cost: null, stock: 3, commissionPct: 10, acquiringPct: 2, extraPct: 5 },
  ]);
  assert.equal(basis.cost, 100);
});

test("кампания на один товар считается ровно как раньше", () => {
  const basis = campaignEconomicsBasis([
    { nm: 1, orders: 30, revenue: 30_000, cost: 400, stock: 12, commissionPct: 18, acquiringPct: 2, extraPct: 7 },
  ]);
  assert.equal(basis.price, 1_000);
  assert.equal(basis.cost, 400);
  assert.equal(basis.dailyUnits, 1);
});

test("роут рекламы берёт ставку налога из настроек кабинета, а экономику — из всех SKU", () => {
  const route = readFileSync(new URL("../app/api/adverts/list/route.ts", import.meta.url), "utf8");
  assert.equal(/taxPct: 7\b/.test(route), false, "захардкоженные 7% возвращаться не должны");
  assert.match(route, /taxPct: taxPctFor\(a\.cabinet_id \?\? null\)/);
  assert.match(route, /const basis = campaignEconomicsBasis\(campaignSkus\)/);
  assert.equal(
    /cost: Number\(report\?\.cost \?\? 0\) > 0 \? Number\(report\?\.cost\) : null/.test(route),
    false,
    "себестоимость первого артикула больше не описывает кампанию",
  );
});
