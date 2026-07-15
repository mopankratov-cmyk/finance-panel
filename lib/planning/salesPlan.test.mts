import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSalesPlanDaily,
  calculateSalesPlanRowMonth,
  createEmptySalesPlan,
  emptySalesPlanMonths,
  type SalesPlanRow,
  validateSalesPlan,
} from "./salesPlan";

function row(): SalesPlanRow {
  const months = emptySalesPlanMonths(2026);
  months["07"][0] = 8;
  return {
    id: "graphite",
    model: "NV-08-35",
    modelName: "Куртка демисезонная",
    variant: "NV-08-35-GRF",
    color: "Графит",
    externalId: "245813920",
    price: 13_500,
    buyout: 29,
    adPct: 12,
    stock: 10,
    image: null,
    isNew: false,
    months,
  };
}

test("реклама считается от заказной выручки до выкупа", () => {
  const daily = calculateSalesPlanDaily(row(), 8);
  assert.equal(daily.gross, 108_000);
  assert.equal(daily.ads, 12_960);
  assert.equal(daily.buyouts, 2);
});

test("месячные итоги используют заказы конкретного цвета", () => {
  const total = calculateSalesPlanRowMonth(row(), "07");
  assert.equal(total.orders, 8);
  assert.equal(total.ads, 12_960);
  assert.equal(total.revenue, 27_000);
});

test("утверждение блокируется при дубле цвета и нулевой цене", () => {
  const plan = createEmptySalesPlan({ marketplace: "wb", cabinetId: "cabinet", year: 2026, responsible: "Анна" });
  const first = row();
  const duplicate = { ...row(), id: "duplicate", price: 0 };
  plan.rows = [first, duplicate];
  const issues = validateSalesPlan(plan);
  assert.ok(issues.some((issue) => issue.message.includes("Дубль вариации")));
  assert.ok(issues.some((issue) => issue.field === "price"));
});
