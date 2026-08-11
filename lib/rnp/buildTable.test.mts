import assert from "node:assert/strict";
import test from "node:test";

import {
  appendOrderConversion,
  applyDerivedRatioCoverage,
  applySalesReturnsAdjustment,
  buildFunnelMetrics,
  buildMetrics,
  buildScopedBaseFactsFromRows,
  type Metric,
} from "./buildTable";

test("конверсия в корзину: пустой день источника не считается нулём", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const metrics = buildFunnelMetrics(
    days,
    "2026-08-03",
    new Map(),
    new Map(),
    new Map([["2026-08-01", 200], ["2026-08-03", 100]]),   // переходы
    new Map([["2026-08-01", 50], ["2026-08-03", 25]]),     // корзины
    { adverts: "2026-08-03", funnel: "2026-08-03" } as never,
  );
  const cartCr = metrics.find((metric) => metric.field === "cart_cr");
  assert.ok(cartCr);
  assert.equal(cartCr!.kind, "pct");
  assert.equal(cartCr!.daily[0], 25);   // 50/200
  assert.equal(cartCr!.daily[1], null); // нет данных — не ноль
  assert.equal(cartCr!.daily[2], 25);   // 25/100
  // Итог считается по суммам, а не как среднее дневных.
  assert.equal(cartCr!.total, 25);
});

test("конверсия в корзину не делится на ноль переходов", () => {
  const days = ["2026-08-01"];
  const metrics = buildFunnelMetrics(
    days, "2026-08-01",
    new Map(), new Map(),
    new Map([["2026-08-01", 0]]),
    new Map([["2026-08-01", 0]]),
    { adverts: "2026-08-01", funnel: "2026-08-01" } as never,
  );
  assert.equal(metrics.find((metric) => metric.field === "cart_cr")!.daily[0], null);
});

function metric(field: string, daily: Array<number | null>, total: number | null, coveragePct = 100): Metric {
  return { field, label: field, kind: "int", daily, total, forecast: null, coveragePct };
}

test("конверсия в заказ считается после слияния воронки и заказов", () => {
  const metrics: Metric[] = [
    metric("open_card", [200, null, 100], 300),
    metric("cart_cr", [25, null, 25], 25),
    metric("orders_count", [20, 5, 10], 30),
  ];
  appendOrderConversion(metrics);
  const orderCr = metrics.find((item) => item.field === "order_cr");
  assert.ok(orderCr);
  assert.equal(orderCr!.daily[0], 10);   // 20/200
  assert.equal(orderCr!.daily[1], null); // нет переходов — не ноль
  assert.equal(orderCr!.daily[2], 10);   // 10/100
  assert.equal(orderCr!.total, 10);      // 30/300, по суммам
  // Встаёт сразу после конверсии в корзину.
  assert.equal(metrics.findIndex((item) => item.field === "order_cr"), 2);
});

test("конверсия в заказ берёт покрытие по слабейшему источнику", () => {
  const metrics: Metric[] = [
    metric("open_card", [100], 100, 40),
    metric("orders_count", [10], 10, 90),
  ];
  appendOrderConversion(metrics);
  assert.equal(metrics.find((item) => item.field === "order_cr")!.coveragePct, 40);
});

test("конверсия в заказ не дублируется и молчит без источника", () => {
  const twice: Metric[] = [metric("open_card", [100], 100), metric("orders_count", [10], 10)];
  appendOrderConversion(twice);
  appendOrderConversion(twice);
  assert.equal(twice.filter((item) => item.field === "order_cr").length, 1);
  const noFunnel: Metric[] = [metric("orders_count", [10], 10)];
  appendOrderConversion(noFunnel);
  assert.equal(noFunnel.some((item) => item.field === "order_cr"), false);
});

const NO_FACTS = { advertSpend: [], stocks: [], products: [], costs: [] };
const order = (date: string, isCancel: boolean, price = 1000) => ({
  nm_id: 1,
  supplier_article: "A-1",
  date,
  total_price: price,
  discount_percent: 0,
  price_with_disc: price,
  is_cancel: isCancel,
});

test("отмена не попадает в поток заказов, но считается отдельной метрикой", () => {
  const { skuRows } = buildScopedBaseFactsFromRows({
    allowedNmIds: [1],
    orders: [order("2026-08-01", false), order("2026-08-01", true, 700)],
    sales: [],
    ...NO_FACTS,
  });
  assert.equal(skuRows.length, 1);
  assert.equal(skuRows[0].orders_count, 1);
  assert.equal(skuRows[0].orders_sum, 1000);
  assert.equal(skuRows[0].cancels_count, 1);
  assert.equal(skuRows[0].cancels_sum, 700);
});

test("день без отмен получает явный ноль, а не пустоту", () => {
  const { skuRows } = buildScopedBaseFactsFromRows({
    allowedNmIds: [1],
    orders: [],
    sales: [{ nm_id: 1, date: "2026-08-01", price_with_disc: 500, finished_price: 450, sale_id: "S1" }],
    ...NO_FACTS,
  });
  // Строку создали продажи, заказов в этот день не было — но путь загрузки
  // отмены знает, поэтому это «отмен не было», а не «нет данных».
  assert.equal(skuRows[0].cancels_count, 0);
  assert.equal(skuRows[0].cancels_sum, 0);
});

test("возврат вычитается из выкупов и остаётся отдельной метрикой", () => {
  const adjusted = applySalesReturnsAdjustment(
    [{ d: "2026-08-01", nm_id: 1, orders_count: 0, orders_sum: 0, buyouts_count: 5, buyouts_sum: 5000, ad_spent: 0 }],
    [{ nm_id: 1, date: "2026-08-01", price_with_disc: 1000, finished_price: 900, sale_id: "R1" }],
  );
  assert.equal(adjusted[0].buyouts_count, 4);
  assert.equal(adjusted[0].buyouts_sum, 4000);
  assert.equal(adjusted[0].returns_count, 1);
  assert.equal(adjusted[0].returns_sum, 1000);
});

test("день без возвратов получает явный ноль", () => {
  const adjusted = applySalesReturnsAdjustment(
    [{ d: "2026-08-01", nm_id: 1, orders_count: 0, orders_sum: 0, buyouts_count: 5, buyouts_sum: 5000, ad_spent: 0 }],
    [],
  );
  assert.equal(adjusted[0].returns_count, 0);
  assert.equal(adjusted[0].returns_sum, 0);
});

const SALES_CUTOFFS = { orders: "2026-08-02", sales: "2026-08-02", adverts: "2026-08-02" };
const salesDay = (overrides: Record<string, number>) => ({
  d: "2026-08-01",
  orders_count: 9,
  orders_sum: 9000,
  buyouts_count: 8,
  buyouts_sum: 8000,
  ad_spent: 0,
  cancels_count: 1,
  cancels_sum: 700,
  returns_count: 2,
  returns_sum: 2000,
  ...overrides,
});

test("доли отмен и возвратов считаются к оформленным заказам и брутто-выкупам", () => {
  const metrics = buildMetrics(
    ["2026-08-01", "2026-08-02"],
    "2026-08-02",
    new Map([["2026-08-01", salesDay({})]]),
    0,
    0,
    SALES_CUTOFFS,
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  assert.equal(find("cancels_count").daily[0], 1);
  assert.equal(find("returns_count").daily[0], 2);
  assert.equal(find("returns_sum").total, 2000);
  // Отмены к оформленным заказам: 1 / (9 + 1).
  assert.equal(find("cancel_pct").daily[0], 10);
  assert.equal(find("cancel_pct").total, 10);
  // Возвраты к выкупам ДО вычета: 2 / (8 + 2). Выкупы в РНП уже нетто.
  assert.equal(find("return_pct").daily[0], 20);
  assert.equal(find("return_pct").total, 20);
});

test("доли молчат в день без потока, а не показывают ноль", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", salesDay({ orders_count: 0, cancels_count: 0, buyouts_count: 0, returns_count: 0 })]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
  );
  assert.equal(metrics.find((item) => item.field === "cancel_pct")!.daily[0], null);
  assert.equal(metrics.find((item) => item.field === "return_pct")!.daily[0], null);
});

test("источник без отмен молчит, а возвраты продолжают считаться", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    // RPC-путь отмены не отдаёт: полей cancels_* в строке нет.
    new Map([["2026-08-01", { d: "2026-08-01", orders_count: 9, orders_sum: 9000, buyouts_count: 8, buyouts_sum: 8000, ad_spent: 0, returns_count: 2, returns_sum: 2000 }]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    0,
    null,
    30,
    { primaryFacts: false },
  );
  const cancels = metrics.find((item) => item.field === "cancels_count")!;
  assert.equal(cancels.daily[0], null);
  assert.equal(cancels.total, null);
  assert.equal(cancels.qualityReason, "unsupported_source");
  assert.equal(metrics.find((item) => item.field === "cancel_pct")!.qualityReason, "unsupported_source");
  // Возвраты грузятся на обоих путях и остаются достоверными.
  assert.equal(metrics.find((item) => item.field === "returns_count")!.daily[0], 2);
  assert.equal(metrics.find((item) => item.field === "return_pct")!.daily[0], 20);
});

test("покрытие производной доли опускается до слабейшего источника", () => {
  const metrics: Metric[] = [
    metric("returns_count", [2], 2, 40),
    metric("buyouts_count", [8], 8, 90),
    { field: "return_pct", label: "return_pct", kind: "pct", daily: [20], total: 20, forecast: null, coveragePct: 100 },
  ];
  applyDerivedRatioCoverage(metrics, "return_pct", ["returns_count", "buyouts_count"]);
  const returnPct = metrics.find((item) => item.field === "return_pct")!;
  assert.equal(returnPct.coveragePct, 40);
  assert.equal(returnPct.qualityReason, "stale_source");
});

test("цены до скидки и после СПП собираются из первичных строк", () => {
  const { skuRows } = buildScopedBaseFactsFromRows({
    allowedNmIds: [1],
    orders: [
      { nm_id: 1, supplier_article: "A-1", date: "2026-08-01", total_price: 2000, discount_percent: 10, price_with_disc: 1800, is_cancel: false },
      // Отменённый заказ в ценовую базу не попадает — иначе скидка считалась бы по нему.
      { nm_id: 1, supplier_article: "A-1", date: "2026-08-01", total_price: 5000, discount_percent: 50, price_with_disc: 2500, is_cancel: true },
    ],
    sales: [{ nm_id: 1, date: "2026-08-01", price_with_disc: 1800, finished_price: 1440, sale_id: "S1" }],
    ...NO_FACTS,
  });
  assert.equal(skuRows[0].orders_gross_sum, 2000);
  assert.equal(skuRows[0].buyouts_gross_sum, 1800);
  assert.equal(skuRows[0].buyouts_finished_sum, 1440);
});

const priceDay = (overrides: Record<string, number> = {}) => ({
  d: "2026-08-01",
  orders_count: 2,
  orders_sum: 3600,
  buyouts_count: 1,
  buyouts_sum: 1800,
  ad_spent: 0,
  cancels_count: 0,
  cancels_sum: 0,
  returns_count: 1,
  returns_sum: 1800,
  orders_gross_sum: 4000,
  buyouts_gross_sum: 3600,
  buyouts_finished_sum: 2880,
  ...overrides,
});

test("скидка продавца и СПП считаются от своих баз", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", priceDay()]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  // Скидка продавца: 1 − 3600/4000.
  assert.equal(find("seller_discount_pct").daily[0], 10);
  assert.equal(find("seller_discount_pct").total, 10);
  // СПП от БРУТТО-выкупов: 1 − 2880/3600. Нетто-выкупы (1800) базой не служат.
  assert.equal(find("spp_pct").daily[0], 20);
  assert.equal(find("spp_pct").total, 20);
  assert.equal(find("avg_order_price").daily[0], 1800);   // 3600/2
  assert.equal(find("avg_buyout_price").daily[0], 1800);  // нетто 1800/1
  // Цена покупателя — на брутто-выкуп: 2880 / (1 нетто + 1 возврат).
  assert.equal(find("final_price").daily[0], 1440);
});

test("ценовые метрики молчат в день без потока", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", priceDay({ orders_count: 0, orders_sum: 0, orders_gross_sum: 0, buyouts_count: 0, buyouts_sum: 0, returns_count: 0, buyouts_gross_sum: 0, buyouts_finished_sum: 0 })]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
  );
  for (const field of ["avg_order_price", "seller_discount_pct", "avg_buyout_price", "final_price", "spp_pct"]) {
    assert.equal(metrics.find((item) => item.field === field)!.daily[0], null, field);
  }
});

test("агрегатный источник молчит по ценам, но средние чеки остаются", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    // RPC-путь отдаёт только потоки: ни цены до скидки, ни finished_price там нет.
    new Map([["2026-08-01", { d: "2026-08-01", orders_count: 2, orders_sum: 3600, buyouts_count: 2, buyouts_sum: 3600, ad_spent: 0, returns_count: 0, returns_sum: 0 }]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    0,
    null,
    30,
    { primaryFacts: false },
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  assert.equal(find("seller_discount_pct").daily[0], null);
  assert.equal(find("seller_discount_pct").qualityReason, "unsupported_source");
  assert.equal(find("spp_pct").qualityReason, "unsupported_source");
  assert.equal(find("final_price").qualityReason, "unsupported_source");
  // Средние чеки выводятся из потоков, доступных на обоих путях.
  assert.equal(find("avg_order_price").daily[0], 1800);
  assert.equal(find("avg_buyout_price").daily[0], 1800);
});
