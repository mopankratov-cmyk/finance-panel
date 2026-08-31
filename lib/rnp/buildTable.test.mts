import assert from "node:assert/strict";
import test from "node:test";

import {
  appendOrderConversion,
  applyDerivedRatioCoverage,
  applyAdvertSpendOverlay,
  applySalesReturnsAdjustment,
  buildFunnelMetrics,
  buildMetrics,
  buildLightweightProductTotals,
  buildScopedBaseFactsFromRows,
  type Metric,
} from "./buildTable";
import { appendTaxMetrics } from "./taxMetrics";

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

test("товар в пути складывается по складам и не попадает в остаток к продаже", () => {
  const totals = buildLightweightProductTotals([{ nm_id: 1 }], [
    { nm_id: 1, quantity: 4, in_way_to_client: 3, in_way_from_client: 1 },
    { nm_id: 1, quantity: 6, in_way_to_client: 2, in_way_from_client: 0 },
  ]);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].stock, 10);
  assert.equal(totals[0].in_way_to_client, 5);
  assert.equal(totals[0].in_way_from_client, 1);
});

test("остатки без колонок в пути не ломаются и дают ноль", () => {
  const totals = buildLightweightProductTotals([], [{ nm_id: 1, quantity: 7 }]);
  assert.equal(totals[0].stock, 7);
  assert.equal(totals[0].in_way_to_client, 0);
  assert.equal(totals[0].in_way_from_client, 0);
});

test("метрики склада показывают снимок только в дате факта", () => {
  const metrics = buildMetrics(
    ["2026-08-01", "2026-08-02"],
    "2026-08-02",
    new Map(),
    10,
    0,
    { orders: "2026-08-02", sales: "2026-08-02", adverts: "2026-08-02" },
    0,
    null,
    30,
    { inWayToClient: 5, inWayFromClient: 2 },
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  assert.equal(find("stock_in_way_to_client").total, 5);
  assert.equal(find("stock_in_way_from_client").total, 2);
  // Всего на складах = остаток к продаже + обе дороги.
  assert.equal(find("stock_total").total, 17);
  // Прошлый день не подменяется сегодняшним снимком.
  assert.equal(find("stock_total").daily[0], null);
  assert.equal(find("stock_total").daily[1], 17);
});

const ECONOMY_RATES = { commissionPct: 20, acquiringPct: 2, extraPct: 8, overheadPct: 0 };
const economyDay = { d: "2026-08-01", orders_count: 0, orders_sum: 0, buyouts_count: 10, buyouts_sum: 10_000, ad_spent: 1_000 };

test("расходы по статьям сходятся с прибылью до копейки", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", economyDay]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    300,                                    // себестоимость единицы
    ECONOMY_RATES.commissionPct + ECONOMY_RATES.extraPct + ECONOMY_RATES.overheadPct + ECONOMY_RATES.acquiringPct,
    30,
    { rates: ECONOMY_RATES },
  );
  const total = (field: string) => metrics.find((item) => item.field === field)!.total!;
  assert.equal(total("cogs"), 3_000);              // 300 × 10
  assert.equal(total("commission_rub"), 2_000);    // 10 000 × 20%
  assert.equal(total("acquiring_rub"), 200);       // 10 000 × 2%
  assert.equal(total("logistics_rub"), 800);       // 10 000 × 8%
  assert.equal(total("mp_cost_rub"), 3_000);       // комиссия + эквайринг + прочее
  // Инвариант: выкупы − себестоимость − расходы МП − реклама = прибыль.
  assert.equal(10_000 - total("cogs") - total("mp_cost_rub") - 1_000, total("gross"));
  assert.equal(total("commission_rub") + total("acquiring_rub") + total("logistics_rub"), total("mp_cost_rub"));
});

test("прибыль на единицу и ROMI считаются от прибыли после рекламы", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", economyDay]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    300,
    30,
    30,
    { rates: ECONOMY_RATES },
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  // gross = 10 000 − 3 000 − 3 000 − 1 000 = 3 000.
  assert.equal(find("gross").total, 3_000);
  assert.equal(find("profit_per_unit").total, 300);   // 3 000 / 10 шт
  assert.equal(find("romi").total, 300);              // 3 000 / 1 000 расхода
});

test("без рекламы ROMI молчит, а не делится на ноль", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", { ...economyDay, ad_spent: 0 }]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    300,
    30,
    30,
    { rates: ECONOMY_RATES },
  );
  assert.equal(metrics.find((item) => item.field === "romi")!.total, null);
  assert.equal(metrics.find((item) => item.field === "romi")!.daily[0], null);
});

test("без разбивки ставок статьи молчат, но общая сумма расходов остаётся", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", economyDay]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    300,
    30,
    30,
    { rates: null },
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  assert.equal(find("commission_rub").total, null);
  assert.equal(find("commission_rub").qualityReason, "missing_rates");
  assert.equal(find("mp_cost_rub").total, 3_000);
  assert.equal(find("cogs").total, 3_000);
});

test("без себестоимости молчит только то, чему она нужна", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", economyDay]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    0,                       // себестоимости нет
    30,                      // ставки WB известны
    30,
    { rates: ECONOMY_RATES },
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  // Расходы маркетплейса считаются от выкупов и ставки — себестоимость им не нужна.
  assert.equal(find("mp_cost_rub").total, 3_000);
  assert.equal(find("commission_rub").total, 2_000);
  assert.equal(find("acquiring_rub").total, 200);
  assert.equal(find("logistics_rub").total, 800);
  // А это без справочника себестоимости посчитать нельзя.
  for (const field of ["cogs", "gross", "profit_per_unit", "romi"]) {
    assert.equal(find(field).total, null, field);
    assert.equal(find(field).qualityReason, "missing_cost", field);
  }
});

test("без ставок WB молчат расходы маркетплейса, а себестоимость остаётся", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", economyDay]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    300,                     // себестоимость есть
    null,                    // ставок нет
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  assert.equal(find("cogs").total, 3_000);
  assert.equal(find("mp_cost_rub").total, null);
  assert.equal(find("mp_cost_rub").qualityReason, "missing_rates");
  assert.equal(find("gross").qualityReason, "missing_rates");
});

function economyMetric(field: string, daily: Array<number | null>, total: number | null, coveragePct = 100): Metric {
  return { field, label: field, kind: "money", daily, total, forecast: null, coveragePct };
}

test("налог и чистая прибыль считаются от выручки, не трогая прибыль до налога", () => {
  const metrics: Metric[] = [
    economyMetric("buyouts_sum", [10_000, 5_000], 15_000),
    economyMetric("margin_pct", [30, 30], 30),
    economyMetric("gross", [3_000, 1_500], 4_500),
  ];
  appendTaxMetrics(metrics, 7);
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  assert.equal(find("tax_rub").daily[0], 700);          // 10 000 × 7%
  assert.equal(find("tax_rub").total, 1_050);           // 15 000 × 7%
  assert.equal(find("net_profit").daily[0], 2_300);     // 3 000 − 700
  assert.equal(find("net_profit").total, 3_450);        // 4 500 − 1 050
  assert.equal(find("net_margin_pct").daily[0], 23);    // 2 300 / 10 000
  assert.equal(find("net_margin_pct").total, 23);       // 3 450 / 15 000
  // Прибыль до налога не меняется — её семантика опубликована.
  assert.equal(find("gross").total, 4_500);
  // Встают сразу после маржи.
  assert.equal(metrics.findIndex((item) => item.field === "tax_rub"), 2);
});

test("нулевая ставка даёт чистую прибыль, равную прибыли", () => {
  const metrics: Metric[] = [
    economyMetric("buyouts_sum", [10_000], 10_000),
    economyMetric("gross", [3_000], 3_000),
  ];
  appendTaxMetrics(metrics, 0);
  assert.equal(metrics.find((item) => item.field === "tax_rub")!.total, 0);
  assert.equal(metrics.find((item) => item.field === "net_profit")!.total, 3_000);
});

test("налог молчит там, где молчит прибыль, и не дублируется", () => {
  const metrics: Metric[] = [
    economyMetric("buyouts_sum", [10_000, null], 10_000),
    { field: "gross", label: "gross", kind: "money", daily: [null, null], total: null, forecast: null, coveragePct: 0, qualityReason: "missing_cost" },
  ];
  appendTaxMetrics(metrics, 7);
  appendTaxMetrics(metrics, 7);
  assert.equal(metrics.filter((item) => item.field === "tax_rub").length, 1);
  assert.equal(metrics.find((item) => item.field === "net_profit")!.total, null);
  assert.equal(metrics.find((item) => item.field === "net_profit")!.qualityReason, "missing_cost");
  // Налог считается от выручки и без себестоимости остаётся известным.
  assert.equal(metrics.find((item) => item.field === "tax_rub")!.daily[0], 700);
  assert.equal(metrics.find((item) => item.field === "tax_rub")!.daily[1], null);
});

test("без прибыли в наборе налоговые строки не появляются", () => {
  const metrics: Metric[] = [economyMetric("buyouts_sum", [10_000], 10_000)];
  appendTaxMetrics(metrics, 7);
  assert.equal(metrics.some((item) => item.field === "tax_rub"), false);
});

test("расходы МП раскладываются по статьям и сходятся с общей суммой удержаний", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", economyDay]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    300,
    30,
    30,
    {
      rates: {
        ...ECONOMY_RATES,
        extraParts: { delivery: 5, storage: 1.5, penalty: 0.5, acceptance: 0.5, deduction: 0.5 },
      },
    },
  );
  const total = (field: string) => metrics.find((item) => item.field === field)!.total!;
  assert.equal(total("delivery_rub"), 500);      // 10 000 × 5%
  assert.equal(total("storage_rub"), 150);
  assert.equal(total("penalty_rub"), 50);
  assert.equal(total("acceptance_rub"), 50);
  assert.equal(total("deduction_rub"), 50);
  // Состав сходится с зонтичной строкой (extraPct 8% = 800).
  const parts = ["delivery_rub", "storage_rub", "penalty_rub", "acceptance_rub", "deduction_rub"];
  assert.equal(parts.reduce((sum, field) => sum + total(field), 0), total("logistics_rub"));
});

test("кэш без разбивки: состав молчит, общая сумма удержаний остаётся", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", economyDay]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    300,
    30,
    30,
    { rates: { ...ECONOMY_RATES, extraParts: null } },
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  for (const field of ["delivery_rub", "storage_rub", "penalty_rub", "acceptance_rub", "deduction_rub"]) {
    assert.equal(find(field).total, null, field);
    assert.equal(find(field).qualityReason, "unsupported_source", field);
  }
  assert.equal(find("logistics_rub").total, 800);
  assert.equal(find("mp_cost_rub").total, 3_000);
});

test("выкуплено — брутто, а фактический % выкупа считается к доставленному", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    // 8 нетто-выкупов + 2 возврата = 10 доставлено покупателю.
    new Map([["2026-08-01", salesDay({})]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  assert.equal(find("buyouts_gross_count").total, 10);
  assert.equal(find("buyouts_count").total, 8);          // нетто не изменилось
  // Доставлено 10, из них оставили 8 → 80%. Прежняя формула делила на 12
  // (возвраты считались дважды) и показывала завышенные 83.3%.
  assert.equal(find("actual_buyout_pct").daily[0], 80);
  assert.equal(find("actual_buyout_pct").total, 80);
});

test("заказы с СПП берут скидку WB того же дня", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    // СПП дня: 2880 / 3600 → покупатель платит 80% цены продавца.
    new Map([["2026-08-01", priceDay({ orders_sum: 10_000 })]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
  );
  assert.equal(metrics.find((item) => item.field === "orders_spp_sum")!.total, 8_000);
});

test("без продаж дня заказы с СПП молчат, а не равны заказам", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", priceDay({ orders_sum: 10_000, buyouts_gross_sum: 0, buyouts_finished_sum: 0 })]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
  );
  assert.equal(metrics.find((item) => item.field === "orders_spp_sum")!.daily[0], null);
});

const schemeOrder = (isCancel: boolean, warehouseType: string | null | undefined, price = 1000) => ({
  nm_id: 1,
  supplier_article: "A-1",
  date: "2026-08-01",
  total_price: price,
  discount_percent: 0,
  price_with_disc: price,
  is_cancel: isCancel,
  ...(warehouseType === undefined ? {} : { warehouse_type: warehouseType }),
});

// Сплит по warehouseType отключён: сверка с кабинетом (2026-08-17) показала,
// что WB метит «Складом продавца» и FBO-отгрузки из транзитных СЦ — поле не
// отражает схему продажи. Пока нет честного источника (FBS-заказы Marketplace
// API), раскладка обязана молчать даже при заполненной колонке.
test("сплит по warehouseType отключён: раскладка молчит даже при заполненной колонке", () => {
  const { skuRows } = buildScopedBaseFactsFromRows({
    allowedNmIds: [1],
    orders: [
      schemeOrder(false, "Склад продавца", 1000),
      schemeOrder(false, "Склад WB", 2000),
      schemeOrder(false, "Склад WB", 3000),
      schemeOrder(true, "Склад продавца", 9000),
    ],
    sales: [],
    ...NO_FACTS,
  });
  assert.equal(skuRows[0].orders_count, 3);
  assert.equal(skuRows[0].orders_fbs_count, undefined);
  assert.equal(skuRows[0].orders_fbw_count, undefined);
});

test("без колонки типа склада разбивка не выдумывает нули", () => {
  const { skuRows } = buildScopedBaseFactsFromRows({
    allowedNmIds: [1],
    // warehouse_type отсутствует как ключ — миграция ещё не применена.
    orders: [schemeOrder(false, undefined, 1000)],
    sales: [],
    ...NO_FACTS,
  });
  assert.equal(skuRows[0].orders_count, 1);
  assert.equal(skuRows[0].orders_fbs_count, undefined);
  assert.equal(skuRows[0].orders_fbw_count, undefined);
});

test("доля FBS считается от заказов с известной схемой", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", {
      d: "2026-08-01",
      orders_count: 10,
      orders_sum: 10_000,
      buyouts_count: 0,
      buyouts_sum: 0,
      ad_spent: 0,
      // Схему знаем только у части заказов: 2 000 FBS + 6 000 FBW из 10 000.
      orders_fbs_sum: 2_000,
      orders_fbs_count: 2,
      orders_fbw_sum: 6_000,
      orders_fbw_count: 6,
    }]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
  );
  const find = (field: string) => metrics.find((item) => item.field === field)!;
  assert.equal(find("orders_fbs_sum").total, 2_000);
  assert.equal(find("orders_fbw_sum").total, 6_000);
  // 2 000 / (2 000 + 6 000) = 25%, а не 2 000 / 10 000 = 20%.
  assert.equal(find("fbs_share_pct").total, 25);
});

test("без признака схемы метрики разбивки молчат", () => {
  const metrics = buildMetrics(
    ["2026-08-01"],
    "2026-08-01",
    new Map([["2026-08-01", { d: "2026-08-01", orders_count: 10, orders_sum: 10_000, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0 }]]),
    0,
    0,
    { orders: "2026-08-01", sales: "2026-08-01", adverts: "2026-08-01" },
    0,
    null,
    30,
    { schemeFacts: false },
  );
  for (const field of ["orders_fbs_count", "orders_fbw_count", "fbs_share_pct"]) {
    const metric = metrics.find((item) => item.field === field)!;
    assert.equal(metric.total, null, field);
    assert.equal(metric.qualityReason, "unsupported_source", field);
  }
  // Общие заказы при этом остаются на месте.
  assert.equal(metrics.find((item) => item.field === "orders_count")!.total, 10);
});

test("расход рекламы берётся из витрины, а не из агрегата", () => {
  // Показы и клики РНП читал прямым запросом к витрине, а расход — через
  // агрегат. Пути разошлись: у кабинета с ограниченным ассортиментом экран
  // рисовал ноль расхода при живых показах, хотя витрина деньги знала.
  const rows = applyAdvertSpendOverlay(
    [{ d: "2026-08-27", nm_id: 111, orders_count: 10, orders_sum: 1000, buyouts_count: 3, buyouts_sum: 300, ad_spent: 0 }],
    [
      { nm_id: 111, date: "2026-08-27", views: 100, clicks: 10, spent: 640.5, orders: 1, orders_sum: 100 },
      { nm_id: 111, date: "2026-08-27", views: 50, clicks: 5, spent: 120, orders: 0, orders_sum: 0 },
    ],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ad_spent, 760.5, "две строки витрины за день складываются");
  assert.equal(rows[0].orders_count, 10, "остальные факты дня не трогаются");
});

test("день с одной только рекламой не теряется", () => {
  const rows = applyAdvertSpendOverlay(
    [],
    [{ nm_id: 222, date: "2026-08-28", views: 10, clicks: 1, spent: 55, orders: 0, orders_sum: 0 }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ad_spent, 55);
  assert.equal(rows[0].orders_count, 0);
});

test("пустая витрина оставляет прежние значения, а не обнуляет их", () => {
  const source = [{ d: "2026-08-27", nm_id: 111, orders_count: 1, orders_sum: 10, buyouts_count: 1, buyouts_sum: 10, ad_spent: 42 }];
  assert.deepEqual(applyAdvertSpendOverlay(source, []), source);
});
