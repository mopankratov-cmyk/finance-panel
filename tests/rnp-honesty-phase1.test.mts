import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  appendOrderConversion,
  buildFunnelMetrics,
  buildMetrics,
  buildReviewMetrics,
  type Metric,
} from "../lib/rnp/buildTable";
import { aggregateRnpWeekly } from "../lib/rnp/operatingMatrix";
import { composeRnpSummaryFromSkus, composeRnpWeeklySummaryFromDailySkus } from "../lib/rnp/summaryFromSkus";

/**
 * Сверка РНП с Оптимой 29.09.2026 (кабинет Оптимы, 22–29.09): «честность цифр».
 * Каждый тест — один случай, где экран показывал число, которому нельзя верить.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const find = (list: Metric[], field: string) => list.find((item) => item.field === field)!;

// ── Сегодняшний день из запасного источника ─────────────────────────────────

const DAYS = ["2026-09-27", "2026-09-28", "2026-09-29"];
const AS_OF = "2026-09-29";
// 29.09 воронки ещё нет: заказы из WB Статистики, их внутри дня половина (33 из ~68).
const row = (d: string, orders: number, ordersSum: number, statSum: number, grossSum: number, ad: number, buyouts: number) => ({
  d,
  orders_count: orders,
  orders_sum: ordersSum,
  buyouts_count: buyouts,
  buyouts_sum: buyouts * 300,
  ad_spent: ad,
  cancels_count: 1,
  cancels_sum: 500,
  orders_gross_sum: grossSum,
  orders_stat_sum: statSum,
  buyouts_gross_sum: buyouts * 300,
  buyouts_finished_sum: buyouts * 290,
  returns_count: 0,
  returns_sum: 0,
});
const byDate = new Map([
  // Воронка: 83 заказа на 64 770 ₽. Статистика знает 70 из них: 26 000 ₽ после
  // скидки продавца, 65 000 ₽ до неё — скидка 60%.
  ["2026-09-27", row("2026-09-27", 83, 64_770, 26_000, 65_000, 5_698, 66)],
  ["2026-09-28", row("2026-09-28", 110, 78_413, 30_000, 75_000, 6_973, 48)],
  // 29.09 — только статистика: заказы = statSum.
  ["2026-09-29", row("2026-09-29", 33, 18_727, 18_727, 46_800, 5_365, 48)],
]);
const CUTOFFS = { orders: "2026-09-29", sales: "2026-09-29", adverts: "2026-09-29", ordersPrimary: "2026-09-28" };
const metrics = () => buildMetrics(DAYS, AS_OF, byDate, 100, 50_000, CUTOFFS, 0, null, 7, {});

test("заказы за незакрытый день видны, но строка «частично» и говорит почему", () => {
  const orders = find(metrics(), "orders_count");
  assert.deepEqual(orders.daily, [83, 110, 33], "сам день не прячем — это пульс");
  assert.equal(orders.status, "partial");
  assert.ok((orders.coveragePct ?? 100) < 100);
  assert.match(orders.note ?? "", /29\.09/);
  assert.match(orders.note ?? "", /WB Статистики/);
});

test("ДРР, выкуп потока и средняя цена за незакрытый день молчат, итог — без него", () => {
  const list = metrics();
  const drr = find(list, "drr");
  assert.equal(drr.daily[2], null, "5 365 ₽ рекламы / 18 727 ₽ половины заказов = 28,7% — выдуманный ДРР");
  assert.equal(drr.total, Math.round(((5_698 + 6_973) / (64_770 + 78_413)) * 1000) / 10);
  assert.ok(drr.parts, "части нужны неделе и сводке под фильтром");
  assert.equal(find(list, "buyout_pct").daily[2], null);
  assert.equal(find(list, "avg_order_price").daily[2], null);
});

test("прогноз заказов — от последнего дня воронки: неполный день не считается фактом", () => {
  const orders = find(metrics(), "orders_count");
  assert.ok((orders.forecast ?? 0) > 83 + 110 + 33, "прогноз добирает сегодняшний день, а не принимает 33 за итог");
});

test("скидка продавца — из одних строк статистики и не уходит в минус", () => {
  // Воронка 64 770 ₽ против 65 000 ₽ «до скидки» из статистики давала бы 0,4%,
  // а 78 413 против 75 000 — минус. Верно — 60% по обоим дням.
  const discount = find(metrics(), "seller_discount_pct");
  assert.deepEqual(discount.daily, [60, 60, 60]);
  assert.equal(discount.total, 60);
  assert.ok(discount.parts);
  assert.ok(discount.daily.every((value) => value == null || value >= 0));
});

test("без воронки вовсе запасных дней нет — поведение прежнее", () => {
  const list = buildMetrics(DAYS, AS_OF, byDate, 100, 50_000, { ...CUTOFFS, ordersPrimary: null }, 0, null, 7, {});
  assert.equal(find(list, "orders_count").status, "ready");
  assert.notEqual(find(list, "drr").daily[2], null);
});

// ── Конверсия в заказ: итог по тем же дням ──────────────────────────────────

test("итог «Конв. в заказ» — заказы только за дни с переходами", () => {
  const metric = (field: string, daily: (number | null)[], total: number | null): Metric => ({
    field, label: field, kind: "int", daily, total, forecast: null, coveragePct: 100,
  });
  const list = [
    metric("open_card", [1000, 1000, null], 2000),
    metric("orders_count", [20, 30, 33], 83),
  ];
  appendOrderConversion(list);
  // Было 83 / 2000 = 4,2%: заказы за 3 дня на переходы за 2.
  assert.equal(find(list, "order_cr").total, 2.5);
});

// ── Покрытие: пустой день — не «готово, 100%» ───────────────────────────────

test("«В избранное» и переходы с пустым сегодняшним днём — «частично», а не «готово»", () => {
  const map = (values: number[]) => new Map(DAYS.slice(0, values.length).map((day, index) => [day, values[index]]));
  const list = buildFunnelMetrics(
    DAYS, AS_OF,
    map([100, 100, 100]), map([10, 10, 10]), map([500, 600]), map([40, 50]),
    { adverts: "2026-09-29", funnel: "2026-09-28" },
    undefined,
    map([5, 6]),
  );
  for (const field of ["open_card", "cart", "wishlist"]) {
    assert.equal(find(list, field).status, "partial", field);
  }
  assert.equal(find(list, "clicks").status, "ready", "реклама за сегодня есть");
});

// ── Отзывы ─────────────────────────────────────────────────────────────────

test("рейтинг отзывов — оценка, а не процент; доля плохих несёт части", () => {
  const list = buildReviewMetrics(DAYS, AS_OF, new Map([
    ["2026-09-27", { count: 10, ratingSum: 40, bad: 2 }],
    ["2026-09-28", { count: 5, ratingSum: 25, bad: 0 }],
  ]));
  assert.equal(find(list, "reviews_rating").kind, "rating", "с kind pct экран рисовал «4.9%»");
  assert.deepEqual(find(list, "reviews_bad_share_pct").parts, { numerator: [2, 0, 0], denominator: [10, 5, 0], scale: 100 });
});

// ── Неделя: доли из сумм, а не последний день ───────────────────────────────

const weeklyTable = (summary: Metric[]) => ({
  period: [{ label: "22.09", period_type: "вт" }, { label: "23.09", period_type: "ср" }],
  summary,
  skus: [],
});

test("неделя: доля плохих и рейтинг — за всю неделю, а не за последний день", () => {
  const reviews = buildReviewMetrics(["2026-09-22", "2026-09-23"], "2026-09-23", new Map([
    ["2026-09-22", { count: 10, ratingSum: 40, bad: 2 }],
    ["2026-09-23", { count: 5, ratingSum: 25, bad: 0 }],
  ]));
  const [week] = aggregateRnpWeekly(weeklyTable(reviews), "2026-09-22", "2026-10-01").summary
    .filter((metric) => metric.field === "reviews_bad_share_pct")
    .map((metric) => metric.daily);
  assert.deepEqual(week, [13.3], "2 плохих из 15; последний день показал бы 0%");
  const rating = aggregateRnpWeekly(weeklyTable(reviews), "2026-09-22", "2026-10-01").summary
    .find((metric) => metric.field === "reviews_rating")!;
  assert.deepEqual(rating.daily, [4.33], "(40 + 25) / 15, а не оценка последнего дня");
});

test("неделя: конверсия — заказы только за дни с переходами", () => {
  const metric = (field: string, kind: string, daily: (number | null)[]): Metric => ({
    field, label: field, kind, daily, total: null, forecast: null,
  });
  const weekly = aggregateRnpWeekly(weeklyTable([
    metric("open_card", "int", [100, null]),
    metric("orders_count", "int", [10, 20]),
    metric("order_cr", "pct", [10, null]),
  ]), "2026-09-22", "2026-10-01");
  assert.deepEqual(weekly.summary.find((metric) => metric.field === "order_cr")!.daily, [10], "(10+20)/100 = 30% — было");
});

// ── Сводка под фильтром ─────────────────────────────────────────────────────

test("под фильтром «Прибыль к запасу» — точка в дате факта, а не во всех днях", () => {
  const metric = (field: string, kind: string, daily: (number | null)[], total: number | null): Metric => ({
    field, label: field, kind, daily, total, forecast: null,
  });
  const template = [metric("gmroi", "pct", [null, -1.8], -1.8)];
  const sku = { metrics: [metric("gross", "money", [100, -200], -100), metric("money", "money", [null, 5_000], 5_000), metric("gmroi", "pct", [null, -2], -2)] };
  const [gmroi] = composeRnpSummaryFromSkus(template, [sku], 7);
  assert.deepEqual(gmroi.daily, [null, -2]);
});

test("под фильтром итог «Конв. в заказ» — по дням, где известны оба поля", () => {
  const metric = (field: string, kind: string, daily: (number | null)[], total: number | null): Metric => ({
    field, label: field, kind, daily, total, forecast: null,
  });
  const template = [metric("order_cr", "pct", [null, null], null)];
  const skus = [
    { metrics: [metric("open_card", "int", [100, null], 100), metric("orders_count", "int", [10, 20], 30)] },
    { metrics: [metric("open_card", "int", [100, null], 100), metric("orders_count", "int", [5, 7], 12)] },
  ];
  const [orderCr] = composeRnpSummaryFromSkus(template, skus, 7);
  assert.equal(orderCr.total, 7.5, "15 / 200; сумма «за все дни» дала бы 42 / 200 = 21%");
});

// Недельный вид под фильтром: 22.09 (вт) – 28.09 (пн) = две корзины, 22–27 и 28.
const WEEK_PERIOD = Array.from({ length: 7 }, (_, index) => ({ label: `${22 + index}.09`, period_type: "день" }));

test("оборачиваемость под фильтром в недельном виде — в днях, по дневным SKU", () => {
  const metric = (field: string, kind: string, daily: (number | null)[], total: number | null): Metric => ({
    field, label: field, kind, daily, total, forecast: null,
  });
  // 7 дней по 10 выкупов → 10 в день; остаток 70 → 7 дней, а не недель.
  const days = Array.from({ length: 7 }, () => 10);
  const lastOnly = (value: number) => [null, null, null, null, null, null, value];
  const daily = {
    period: WEEK_PERIOD,
    summary: [metric("buyouts_count", "int", days, 70), metric("stock", "int", lastOnly(70), 70), metric("turnover", "int", lastOnly(7), 7)],
    skus: [
      { nm: 1, metrics: [metric("buyouts_count", "int", days, 70), metric("stock", "int", lastOnly(70), 70), metric("turnover", "int", lastOnly(7), 7)] },
      { nm: 2, metrics: [metric("buyouts_count", "int", days, 70), metric("stock", "int", lastOnly(900), 900), metric("turnover", "int", lastOnly(90), 90)] },
    ],
  };
  const turnover = composeRnpWeeklySummaryFromDailySkus(daily, new Set([1]), 7, "2026-09-22", "2026-09-28")
    .find((item) => item.field === "turnover")!;
  assert.equal(turnover.total, 7);
  assert.deepEqual(turnover.daily, [null, 7]);
});

test("под фильтром недельный итог совпадает с дневным", () => {
  const metric = (field: string, kind: string, daily: (number | null)[], total: number | null): Metric => ({
    field, label: field, kind, daily, total, forecast: null,
  });
  // Переходы за 28.09 ещё не пришли, заказы — уже есть.
  const skuMetrics = (open: number, orders: number) => [
    metric("open_card", "int", [open, open, open, open, open, open, null], open * 6),
    metric("orders_count", "int", [orders, orders, orders, orders, orders, orders, 50], orders * 6 + 50),
    metric("order_cr", "pct", [null, null, null, null, null, null, null], null),
  ];
  const template = [
    metric("open_card", "int", Array(7).fill(null), null),
    metric("orders_count", "int", Array(7).fill(null), null),
    metric("order_cr", "pct", Array(7).fill(null), null),
  ];
  const skus = [{ nm: 1, metrics: skuMetrics(100, 5) }, { nm: 2, metrics: skuMetrics(100, 3) }, { nm: 3, metrics: skuMetrics(1, 1) }];
  const visible = new Set([1, 2]);
  const dayTotal = composeRnpSummaryFromSkus(template, skus.filter((sku) => visible.has(sku.nm)), 7)
    .find((item) => item.field === "order_cr")!.total;
  const week = composeRnpWeeklySummaryFromDailySkus({ period: WEEK_PERIOD, summary: template, skus }, visible, 7, "2026-09-22", "2026-09-28")
    .find((item) => item.field === "order_cr")!;
  assert.equal(dayTotal, 4, "48 заказов / 1200 переходов за дни, где известны оба");
  assert.equal(week.total, dayTotal, "итог не зависит от переключателя «День / Неделя»");
  assert.deepEqual(week.daily, [4, null], "неделя 28.09 без переходов молчит, а не делит 100 заказов на ноль");
  const page = read("../components/wb/WbRnpPage.tsx");
  assert.match(page, /composeRnpWeeklySummaryFromDailySkus\(dailyData,/);
  assert.match(page, /composeRnpWeeklySummaryFromDailySkus\(dailyPrevious,/);
});

// ── Подписи совпадают с формулами ───────────────────────────────────────────

test("подписи говорят, что считают", () => {
  const source = read("../lib/rnp/buildTable.ts");
  assert.match(source, /label: "Прибыль после МП и рекламы, ₽"/);
  assert.match(source, /label: "Остаток \+ в пути, шт"/);
  assert.match(source, /label: "Прибыль к запасу за период, %"/);
  assert.doesNotMatch(source, /"Платная логистика из финотчёта\."/);
  const page = read("../components/wb/WbRnpPage.tsx");
  assert.match(page, /label="Прибыль после МП и рекламы"/);
  assert.doesNotMatch(page, /label: "Прибыль после расходов МП, ₽"/);
});
