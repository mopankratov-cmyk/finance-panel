import assert from "node:assert/strict";
import test from "node:test";
import type { SalesPlanDocument, SalesPlanRow } from "@/lib/planning/salesPlan";
import {
  deriveWbPlanForMonth,
  listWbPlanMonths,
  selectWbPlanDocument,
} from "@/lib/opiu/wbPlan";

// Дни месяца с равномерными заказами: сумма = orders.
function ordersDays(total: number, days = 31): number[] {
  const perDay = Math.floor(total / days);
  const remainder = total - perDay * days;
  return Array.from({ length: days }, (_, index) => perDay + (index < remainder ? 1 : 0));
}

function makeRow(input: {
  variant: string;
  price: number;
  buyout: number;
  months: Record<string, number[]>;
  externalId?: string;
  model?: string;
}): SalesPlanRow {
  return {
    id: input.variant,
    model: input.model ?? input.variant.split("-").slice(0, -1).join("-"),
    modelName: input.variant,
    variant: input.variant,
    color: "цвет",
    externalId: input.externalId ?? "",
    price: input.price,
    buyout: input.buyout,
    adPct: 0,
    stock: 0,
    image: null,
    isNew: false,
    months: input.months,
  } as unknown as SalesPlanRow;
}

function makeDoc(rows: SalesPlanRow[]): SalesPlanDocument {
  return { schemaVersion: 1, rows } as unknown as SalesPlanDocument;
}

// buyouts = round(orders * buyout/100); revenue = round(buyouts * price).
// 100 заказов × 90% выкупа × 2000 ₽ = 90 выкупов × 2000 = 180 000 ₽.
const AUG_ROW = makeRow({
  variant: "ht-42-blue",
  price: 2000,
  buyout: 90,
  externalId: "111",
  months: { "08": ordersDays(100) },
});

test("§2/§20: план читается из planning_state, старая sales_plan не нужна", () => {
  const envelope = { working: makeDoc([AUG_ROW]), approved: null, approvedByMonth: {} };
  const selection = deriveWbPlanForMonth(envelope, "08");
  assert.equal(selection.source, "working_sales_plan");
  assert.equal(selection.articles.length, 1);
  assert.equal(selection.articles[0].article, "HT-42-BLUE");
  assert.equal(selection.articles[0].planOrders, 100);
  assert.equal(selection.articles[0].planRevenue, 180_000);
  assert.equal(selection.planRevenue, 180_000);
});

test("§20: утверждённый план имеет приоритет над рабочим", () => {
  const working = makeDoc([makeRow({ variant: "ht-42-blue", price: 2000, buyout: 90, months: { "08": ordersDays(100) } })]);
  const approved = makeDoc([makeRow({ variant: "ht-42-blue", price: 2000, buyout: 90, months: { "08": ordersDays(50) } })]);
  const selection = deriveWbPlanForMonth({ working, approved, approvedByMonth: {} }, "08");
  assert.equal(selection.source, "approved_sales_plan");
  assert.equal(selection.articles[0].planOrders, 50);
});

test("§20: approvedByMonth выбирается строго по месяцу", () => {
  const monthly = makeDoc([makeRow({ variant: "x-1", price: 1000, buyout: 100, months: { "08": ordersDays(10) } })]);
  const selection = deriveWbPlanForMonth(
    { working: null, approved: null, approvedByMonth: { "08": monthly } },
    "08",
  );
  assert.equal(selection.source, "approved_sales_plan");
  assert.equal(selection.planRevenue, 10_000);
});

test("§20: строго выбранный месяц — заказы августа не попадают в сентябрь", () => {
  const envelope = { working: makeDoc([AUG_ROW]), approved: null, approvedByMonth: {} };
  const september = deriveWbPlanForMonth(envelope, "09");
  assert.equal(september.source, "none");
  assert.equal(september.articles.length, 0);
  assert.equal(september.planRevenue, 0);
});

test("§8/§19: отсутствие плана не превращается в ноль-строку, а даёт source none", () => {
  assert.deepEqual(deriveWbPlanForMonth(null, "08"), {
    source: "none", articles: [], planRevenue: 0, planOrders: 0,
  });
  assert.deepEqual(deriveWbPlanForMonth({ working: makeDoc([]), approved: null, approvedByMonth: {} }, "08"), {
    source: "none", articles: [], planRevenue: 0, planOrders: 0,
  });
});

test("§20: одинаковый артикул в нескольких строках суммируется", () => {
  const rows = [
    makeRow({ variant: "dup-1", price: 1000, buyout: 100, months: { "08": ordersDays(30) } }),
    makeRow({ variant: "DUP-1", price: 1000, buyout: 100, months: { "08": ordersDays(20) } }),
  ];
  const selection = deriveWbPlanForMonth({ working: makeDoc(rows), approved: null, approvedByMonth: {} }, "08");
  assert.equal(selection.articles.length, 1);
  assert.equal(selection.articles[0].planOrders, 50);
});

test("§19: расчёт одного кабинета не видит данные другого (изоляция по envelope)", () => {
  const cabinetA = { working: makeDoc([makeRow({ variant: "a-1", price: 1000, buyout: 100, months: { "08": ordersDays(10) } })]), approved: null, approvedByMonth: {} };
  const cabinetB = { working: makeDoc([makeRow({ variant: "b-1", price: 1000, buyout: 100, months: { "08": ordersDays(99) } })]), approved: null, approvedByMonth: {} };
  const a = deriveWbPlanForMonth(cabinetA, "08");
  const b = deriveWbPlanForMonth(cabinetB, "08");
  assert.deepEqual(a.articles.map((item) => item.article), ["A-1"]);
  assert.deepEqual(b.articles.map((item) => item.article), ["B-1"]);
  assert.notEqual(a.planRevenue, b.planRevenue);
});

test("§18/§19: исходный документ плана не мутируется", () => {
  const row = makeRow({ variant: "keep-1", price: 1000, buyout: 100, months: { "08": ordersDays(10) } });
  const doc = makeDoc([row]);
  const snapshot = JSON.stringify(doc);
  deriveWbPlanForMonth({ working: doc, approved: null, approvedByMonth: {} }, "08");
  assert.equal(JSON.stringify(doc), snapshot);
});

test("selectWbPlanDocument возвращает null для пустого месяца", () => {
  assert.equal(selectWbPlanDocument({ working: makeDoc([AUG_ROW]) }, "09"), null);
});

test("listWbPlanMonths перечисляет месяцы с заказами выбранного года", () => {
  const doc = makeDoc([makeRow({
    variant: "m-1", price: 1000, buyout: 100,
    months: { "08": ordersDays(10), "11": ordersDays(5) },
  })]);
  const months = listWbPlanMonths({ working: doc, approved: null, approvedByMonth: {} }, 2026);
  assert.deepEqual(months, [{ year: 2026, month: 8 }, { year: 2026, month: 11 }]);
});
