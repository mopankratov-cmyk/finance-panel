import assert from "node:assert/strict";
import test from "node:test";
import { aggregateOzonSources, aggregateWbSources, coalesceWbSources, wbBrandCompanyName, type MonthlyMarketplaceSource } from "./monthlyMarketplaceSources.ts";

const wb = (revenue: number) => ({
  revenue_before_spp: revenue,
  commission: 0,
  acquiring: 0,
  ad: 0,
  other: 0,
  cogs: 0,
  packaging: 0,
  logistics: 0,
  storage: 0,
  penalty: 0,
});

test("WB-колонки суммируются в общий факт без потери разреза", () => {
  const sources: MonthlyMarketplaceSource[] = [
    { id: "wb-a", label: "WB ИП А", marketplace: "wb", wb: { revenue_before_spp: 100, commission: 10, acquiring: 1, ad: 2, other: 3, cogs: 20, packaging: 4, logistics: 5, storage: 6, penalty: 7 } },
    { id: "wb-b", label: "WB ИП Б", marketplace: "wb", wb: { revenue_before_spp: 200, commission: 20, acquiring: 2, ad: 4, other: 6, cogs: 40, packaging: 8, logistics: 10, storage: 12, penalty: 14 } },
  ];
  const total = aggregateWbSources(sources);
  assert.equal(total.revenue_before_spp, 300);
  assert.equal(total.commission, 30);
  assert.equal(total.logistics, 15);
});

test("Ozon-колонки суммируются по кабинетам", () => {
  const sources: MonthlyMarketplaceSource[] = [
    { id: "ozon-a", label: "Ozon ИП А", marketplace: "ozon", ozon: { revenue: 100, commission: 10, delivery: 5, services: 2, cogs: 20 } },
    { id: "ozon-b", label: "Ozon ИП Б", marketplace: "ozon", ozon: { revenue: 200, commission: 20, delivery: 10, services: 4, cogs: 40 } },
  ];
  assert.equal(aggregateOzonSources(sources).revenue, 300);
});

test("один бренд из нескольких WB-кабинетов показывается одной колонкой", () => {
  const sources = coalesceWbSources([
    { id: "wb:norvia", label: "WB Norvia", marketplace: "wb", companyId: "company-1", wb: wb(100) },
    { id: "wb:optima-norvia", label: "WB Norvia", marketplace: "wb", companyId: "company-1", wb: wb(250) },
  ]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.wb?.revenue_before_spp, 350);
});

test("частичный сбой второго WB-кабинета остаётся предупреждением бренда", () => {
  const sources = coalesceWbSources([
    { id: "wb:heaton", label: "WB Heaton", marketplace: "wb", companyId: "company-1", wb: wb(100) },
    { id: "wb:optima-heaton", label: "WB Heaton", marketplace: "wb", companyId: "company-1", wb: { ...wb(0), error: "Оптима недоступна" } },
  ]);
  assert.equal(sources[0]?.wb?.revenue_before_spp, 100);
  assert.deepEqual(sources[0]?.wb?.warnings, ["Оптима недоступна"]);
});

test("Riobox принадлежит Оптиме, а не Филиппову/Коровкину", () => {
  assert.equal(wbBrandCompanyName({ id: "norvia", entity: "Retail Family" }), "ИП Филиппов");
  assert.equal(wbBrandCompanyName({ id: "heaton", entity: "Retail Family" }), "ИП Филиппов");
  assert.equal(wbBrandCompanyName({ id: "optima-norvia", entity: "Retail Family" }), "Оптима");
  assert.equal(wbBrandCompanyName({ id: "optima-heaton", entity: "Retail Family" }), "Оптима");
  assert.equal(wbBrandCompanyName({ id: "optima-riobox", entity: "ООО РИО" }), "Оптима");
});
