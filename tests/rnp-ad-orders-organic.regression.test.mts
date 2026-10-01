import assert from "node:assert/strict";
import test from "node:test";

import { appendOrganicMetrics, buildFunnelMetrics, type Metric } from "../lib/rnp/buildTable";
import { RNP_METRIC_FIELDS } from "../lib/rnp/operatingMatrix";

// Паритет с кабинетом Оптимы: заказы из рекламы (атрибуция WB) и органика =
// всё минус реклама. Данные атрибуции давно пишутся синком advert-stats в
// wb_advert_nm_daily (orders, orders_sum) — РНП их просто не выводил.

const days = ["2026-08-11", "2026-08-12"];
const asOf = "2026-08-12";
const cutoffs = { adverts: "2026-08-12", funnel: "2026-08-12" };
const byDate = (values: number[]) => new Map(days.map((day, index) => [day, values[index]]));

test("заказы из рекламы попадают в воронку из атрибуции", () => {
  const metrics = buildFunnelMetrics(
    days, asOf,
    byDate([1000, 2000]), byDate([100, 200]), byDate([500, 600]), byDate([50, 60]),
    cutoffs,
    { ordersByDate: byDate([30, 40]), ordersSumByDate: byDate([9000, 12000]) },
  );
  const adOrders = metrics.find((metric) => metric.field === "ad_orders");
  const adOrdersSum = metrics.find((metric) => metric.field === "ad_orders_sum");
  assert.deepEqual(adOrders?.daily, [30, 40]);
  assert.equal(adOrders?.total, 70);
  assert.equal(adOrdersSum?.total, 21_000);
});

test("без атрибуции воронка собирается как раньше", () => {
  const metrics = buildFunnelMetrics(days, asOf, byDate([1, 1]), byDate([1, 1]), byDate([1, 1]), byDate([1, 1]), cutoffs);
  assert.equal(metrics.some((metric) => metric.field === "ad_orders"), false);
});

const metric = (field: string, daily: Array<number | null>, total: number | null): Metric => ({
  field, label: field, kind: "int", daily, total, forecast: null, source: "тест", coveragePct: 100,
});

test("органика = всё минус реклама, по дням и итогу", () => {
  const metrics: Metric[] = [
    metric("open_card", [500, 600], 1100),
    metric("clicks", [100, 200], 300),
    metric("orders_count", [50, 70], 120),
    metric("ad_orders", [30, 40], 70),
  ];
  appendOrganicMetrics(metrics);
  const orgVisits = metrics.find((item) => item.field === "org_open_card");
  const orgOrders = metrics.find((item) => item.field === "org_orders_count");
  const orgCr = metrics.find((item) => item.field === "org_cr_pct");
  const orgShare = metrics.find((item) => item.field === "org_share_pct");
  assert.deepEqual(orgVisits?.daily, [400, 400]);
  assert.equal(orgVisits?.total, 800);
  assert.deepEqual(orgOrders?.daily, [20, 30]);
  assert.equal(orgOrders?.total, 50);
  // 50 / 800 = 6.3%; доля органики в переходах 800/1100 = 72.7%.
  assert.equal(orgCr?.total, 6.3);
  assert.equal(orgShare?.total, 72.7);
});

// Атрибуция WB когортная: заказ приписан рекламе в течение окна после клика,
// и день всплеска может дать «рекламных» больше, чем всех заказов дня.
test("отрицательный день органики молчит, а не показывается нулём", () => {
  // Органику такого дня не определить: ноль был бы выдуманным фактом, и сумма
  // зажатых нулей расходилась бы с итогом (правило «недоступный факт молчит»).
  const metrics: Metric[] = [
    metric("open_card", [500], 500),
    metric("clicks", [600], 600),
    metric("orders_count", [50], 50),
    metric("ad_orders", [80], 80),
  ];
  appendOrganicMetrics(metrics);
  assert.deepEqual(metrics.find((item) => item.field === "org_open_card")?.daily, [null]);
  assert.deepEqual(metrics.find((item) => item.field === "org_orders_count")?.daily, [null]);
  assert.equal(metrics.find((item) => item.field === "org_orders_count")?.total, null);
});

test("итог органики — сумма показанных дней, даже когда источники кончаются в разные дни", () => {
  // 29.09 воронки ещё нет, а клики и заказы есть. Раньше итог вычитал клики за
  // 8 дней из переходов за 7: 13 315 при сумме дней 14 635.
  const metrics: Metric[] = [
    metric("open_card", [1000, 1200, null], 2200),
    metric("clicks", [100, 150, 900], 1150),
    metric("orders_count", [40, 50, 33], 123),
    metric("ad_orders", [10, 20, 54], 84),
  ];
  appendOrganicMetrics(metrics);
  const orgOpen = metrics.find((item) => item.field === "org_open_card")!;
  assert.deepEqual(orgOpen.daily, [900, 1050, null]);
  assert.equal(orgOpen.total, 1950);
  const share = metrics.find((item) => item.field === "org_share_pct")!;
  assert.equal(share.total, 88.6, "1950 / 2200 — переходы тех же двух дней");
});

test("незакрытый день с заказами из статистики — органика заказов молчит", () => {
  // 29.09: заказов в статистике 33 из ~68, рекламных 54. «33 − 54» — не органика.
  const days3 = ["2026-09-27", "2026-09-28", "2026-09-29"];
  const metrics: Metric[] = [
    metric("open_card", [1000, 1200, null], 2200),
    metric("clicks", [100, 150, 900], 1150),
    metric("orders_count", [80, 110, 33], 223),
    metric("ad_orders", [50, 75, 20], 145),
  ];
  appendOrganicMetrics(metrics, { days: days3, ordersPrimary: "2026-09-28" });
  const orgOrders = metrics.find((item) => item.field === "org_orders_count")!;
  assert.deepEqual(orgOrders.daily, [30, 35, null], "33 − 20 = 13 выглядело бы честным числом, но день не полный");
  assert.equal(orgOrders.total, 65);
});

test("пустой день источника остаётся пустым, а не нулём", () => {
  const metrics: Metric[] = [
    metric("open_card", [500, null], 500),
    metric("clicks", [100, null], 100),
    metric("orders_count", [50, 60], 110),
    metric("ad_orders", [30, null], 30),
  ];
  appendOrganicMetrics(metrics);
  assert.deepEqual(metrics.find((item) => item.field === "org_open_card")?.daily, [400, null]);
  assert.deepEqual(metrics.find((item) => item.field === "org_orders_count")?.daily, [20, null]);
});

test("новые поля зарегистрированы в каталоге метрик", () => {
  for (const field of ["ad_orders", "ad_orders_sum", "org_open_card", "org_orders_count", "org_cr_pct", "org_share_pct"]) {
    assert.ok((RNP_METRIC_FIELDS as readonly string[]).includes(field), `нет поля ${field}`);
  }
});
