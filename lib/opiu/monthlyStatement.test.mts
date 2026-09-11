import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthlyOpiuStatement, MONTHLY_OPIU_ARTICLES } from "./monthlyStatement.ts";

const actual = {
  wb: {
    revenue_before_spp: 1_000,
    commission: 120,
    acquiring: 20,
    ad: 50,
    other: 10,
    cogs: 300,
    packaging: 20,
    logistics: null,
    storage: null,
    penalty: null,
    warnings: [],
  },
  ozon: {
    revenue: 500,
    commission: 60,
    delivery: 40,
    services: 20,
    cogs: 150,
    warnings: [],
  },
};

test("справочник ОПиУ содержит все заполненные статьи исходного листа", () => {
  assert.equal(MONTHLY_OPIU_ARTICLES.length, 32);
  assert.equal(new Set(MONTHLY_OPIU_ARTICLES.map((article) => article.id)).size, 32);
  assert.ok(MONTHLY_OPIU_ARTICLES.some((article) => article.label === "Продажи на МП"));
  assert.ok(MONTHLY_OPIU_ARTICLES.some((article) => article.label === "Выплаты процентов по займам и кредитам"));
});

test("маркетплейсы складываются по направлениям, но неизвестные расходы не превращаются в ноль", () => {
  const statement = buildMonthlyOpiuStatement(actual);
  const sales = statement.rows.find((row) => row.id === "marketplace_sales")!;
  const logistics = statement.rows.find((row) => row.id === "marketplace_logistics")!;
  assert.equal(sales.amounts.total.value, 1_500);
  assert.equal(logistics.amounts.wb.status, "missing");
  assert.equal(logistics.amounts.ozon.value, 40);
  assert.equal(logistics.amounts.total.value, null);
  assert.equal(logistics.amounts.total.known, 40);
  assert.equal(statement.netProfit.value, null);
  assert.equal(statement.netProfit.status, "partial");
});

test("смешанные услуги Ozon остаются частичными, потому что их нельзя честно разнести по статьям", () => {
  const statement = buildMonthlyOpiuStatement(actual);
  const other = statement.rows.find((row) => row.id === "marketplace_other")!;
  assert.equal(other.amounts.ozon.status, "partial");
  assert.equal(other.amounts.ozon.known, 20);
  assert.match(other.amounts.ozon.note ?? "", /одной суммой/);
});
