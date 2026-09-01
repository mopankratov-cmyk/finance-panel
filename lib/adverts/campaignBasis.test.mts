import assert from "node:assert/strict";
import test from "node:test";

import { campaignEconomicsBasis, type CampaignSkuFacts } from "./campaignBasis.ts";

const sku = (over: Partial<CampaignSkuFacts> = {}): CampaignSkuFacts => ({
  nm: 1,
  orders: 10,
  revenue: 10_000,
  cost: 300,
  stock: 100,
  commissionPct: 20,
  acquiringPct: 2,
  extraPct: 5,
  ...over,
});

test("неизвестная комиссия не притворяется нулём", () => {
  // Кабинет с пустым кэшем комиссий: ставки не знает никто.
  const basis = campaignEconomicsBasis([sku({ commissionPct: null })]);
  assert.equal(basis.commissionPct, null);
  assert.equal(basis.feesCoverage, 0);
});

test("покрытие показывает, какой доле выручки известны ставки", () => {
  const basis = campaignEconomicsBasis([
    sku({ nm: 1, revenue: 7_500, commissionPct: 20 }),
    sku({ nm: 2, revenue: 2_500, commissionPct: null }),
  ]);
  assert.equal(basis.feesCoverage, 0.75);
  // Среднее считается по известной части, а не размывается нулём неизвестной.
  assert.equal(basis.commissionPct, 20);
});

test("полное покрытие даёт единицу", () => {
  const basis = campaignEconomicsBasis([sku({ nm: 1 }), sku({ nm: 2, commissionPct: 25, revenue: 10_000 })]);
  assert.equal(basis.feesCoverage, 1);
  assert.equal(basis.commissionPct, 22.5);
});

test("без выручки покрытие не определено, а не равно нулю", () => {
  // «Не из чего считать» и «известно, что не знаем» — разные ответы: в первом
  // случае решение принимается по среднему кабинета, во втором — не принимается.
  const basis = campaignEconomicsBasis([sku({ revenue: 0, orders: 0 })]);
  assert.equal(basis.feesCoverage, null);
  assert.equal(basis.commissionPct, null);
});

test("ставка ноль остаётся законной ставкой", () => {
  // Эквайринг действительно бывает нулевым — это знание, а не его отсутствие.
  const basis = campaignEconomicsBasis([sku({ commissionPct: 0, acquiringPct: 0 })]);
  assert.equal(basis.commissionPct, 0);
  assert.equal(basis.feesCoverage, 1);
});

test("себестоимость молчит, если её нет хотя бы у одного продающегося товара", () => {
  const basis = campaignEconomicsBasis([sku({ nm: 1 }), sku({ nm: 2, cost: null, orders: 5 })]);
  assert.equal(basis.cost, null);
  assert.equal(basis.costKnownCount, 1);
});

test("товар без заказов не мешает знать себестоимость кампании", () => {
  const basis = campaignEconomicsBasis([sku({ nm: 1 }), sku({ nm: 2, cost: null, orders: 0, revenue: 0 })]);
  assert.equal(basis.cost, 300);
});

test("цена и себестоимость взвешены по заказам, ставки — по выручке", () => {
  const basis = campaignEconomicsBasis([
    sku({ nm: 1, orders: 1, revenue: 1_000, cost: 100, commissionPct: 10 }),
    sku({ nm: 2, orders: 9, revenue: 9_000, cost: 500, commissionPct: 30 }),
  ]);
  assert.equal(basis.price, 1_000);
  assert.equal(basis.cost, (100 * 1 + 500 * 9) / 10);
  assert.equal(basis.commissionPct, (10 * 1_000 + 30 * 9_000) / 10_000);
});
