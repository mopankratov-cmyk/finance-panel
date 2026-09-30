import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyFbsSchemeSplit, buildMetrics, type Metric } from "../lib/rnp/buildTable";
import { aggregateRnpWeekly } from "../lib/rnp/operatingMatrix";
import { composeRnpSummaryFromSkus, composeRnpWeeklySummaryFromDailySkus } from "../lib/rnp/summaryFromSkus";

/**
 * Фаза 2 сверки РНП с Оптимой (29.09.2026): данные заказов и выкупов.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const find = (list: Metric[], field: string) => list.find((item) => item.field === field)!;

const DAYS = ["2026-09-22", "2026-09-23"];
const AS_OF = "2026-09-23";
const CUTOFFS = { orders: AS_OF, sales: AS_OF, adverts: AS_OF, ordersPrimary: AS_OF };
// Прод, кабинет Оптимы, 22.09: 51 строка продаж на 13 289,47 ₽ и 1 возврат
// чужой продажи на 4 553 ₽ — нетто 50 шт на 8 736,47 ₽.
const row = (d: string, buyouts: number, buyoutsSum: number, returns: number, returnsSum: number) => ({
  d,
  orders_count: 20,
  orders_sum: 21_444,
  buyouts_count: buyouts,
  buyouts_sum: buyoutsSum,
  returns_count: returns,
  returns_sum: returnsSum,
  ad_spent: 42,
});
const metrics = (primaryFacts = true) => buildMetrics(
  DAYS,
  AS_OF,
  new Map([
    ["2026-09-22", row("2026-09-22", 50, 8_736.47, 1, 4_553)],
    ["2026-09-23", row("2026-09-23", 42, 14_943.41, 1, 244)],
  ]),
  0,
  0,
  CUTOFFS,
  0,
  null,
  7,
  { primaryFacts },
);

test("средняя цена выкупа — по валовым выкупам, а не нетто минус чужие возвраты", () => {
  const price = find(metrics(), "avg_buyout_price");
  // Было 8 736,47 / 50 = 175 ₽ — ниже цены покупателя после СПП.
  assert.equal(price.daily[0], Math.round(13_289.47 / 51));
  assert.equal(price.total, Math.round((13_289.47 + 15_187.41) / (51 + 43)));
  assert.ok(price.parts, "части нужны неделе и сводке под фильтром");
});

test("средняя цена выкупа считается и без первичных строк", () => {
  assert.equal(find(metrics(false), "avg_buyout_price").daily[0], Math.round(13_289.47 / 51));
});

test("неделя и фильтр: средняя цена выкупа из сумм, а не последний день", () => {
  const summary = metrics();
  const [week] = aggregateRnpWeekly(
    { period: DAYS.map((d) => ({ label: d.slice(8), period_type: "день" })), summary, skus: [] },
    "2026-09-22",
    "2026-09-28",
  ).summary.filter((metric) => metric.field === "avg_buyout_price").map((metric) => metric.daily[0]);
  assert.equal(week, Math.round((13_289.47 + 15_187.41) / 94));
  const composed = composeRnpSummaryFromSkus(summary, [{ metrics: metrics() }, { metrics: metrics() }], 7);
  assert.equal(find(composed, "avg_buyout_price").total, Math.round((13_289.47 + 15_187.41) / 94));
});

test("когорта: «известный исход» и «окончательный итог» — разные подписи", () => {
  const source = read("../lib/rnp/buildTable.ts");
  assert.match(source, /label: "Окончательный итог, %"/);
  assert.doesNotMatch(source, /«Заказы с итогом»/);
  assert.match(source, /заказы с известным исходом/);
  const page = read("../components/wb/WbRnpPage.tsx");
  assert.match(page, /cohort_resolved_pct: \{ label: "Окончательный итог, %"/);
});

// ── FBW = Заказы − FBS ───────────────────────────────────────────────────────
// Прод 30.09: на 22–28.09 воронка у Оптимы — 441 заказ, строк WB Статистики — 384
// с отменами. Две догрузки (всё изменённое с 24.09 и с 27.09) не добавили ни одной
// строки за 24–28.09: WB этих заказов в статистику ещё не отдал. FBS поэтому
// берётся из сборочных заданий, а FBW — заказы минус FBS.

type Row = Parameters<typeof applyFbsSchemeSplit>[0][number];
const skuRow = (nm: number, d: string, orders: number, ordersSum: number, stale?: { fbs: number; fbw: number }): Row => ({
  nm_id: nm,
  d,
  orders_count: orders,
  orders_sum: ordersSum,
  buyouts_count: 0,
  buyouts_sum: 0,
  ad_spent: 0,
  // Поля из строк Статистики — прежняя разбивка, она должна быть заменена.
  ...(stale ? { orders_fbs_count: stale.fbs, orders_fbs_sum: stale.fbs * 100, orders_fbw_count: stale.fbw, orders_fbw_sum: stale.fbw * 100 } : {}),
});
const tasks = (cutoff: string | null, entries: [string, number][]) => ({ cutoff, counts: new Map(entries) });

test("FBS — по сборочным заданиям, FBW — заказы минус FBS, рубли по цене артикула", () => {
  const [day1, day2, day3] = applyFbsSchemeSplit([
    // 20 заказов воронки на 14 000 ₽; Статистика знала 0 FBS + 15 без задания.
    skuRow(1, "2026-09-22", 20, 14_000, { fbs: 0, fbw: 15 }),
    // 3 заказа только в воронке: строк Статистики нет, а FBS-задание — есть.
    skuRow(1, "2026-09-23", 3, 2_100),
    // После границы синка заданий схема неизвестна.
    skuRow(1, "2026-09-24", 5, 3_500, { fbs: 1, fbw: 4 }),
  ], tasks("2026-09-23", [["1|2026-09-22", 1], ["1|2026-09-23", 1]]), "2026-09-24");
  assert.equal(day1.orders_fbs_count, 1);
  assert.equal(day1.orders_fbw_count, 19);
  assert.equal(day1.orders_fbs_sum, 700);
  assert.equal(day1.orders_fbw_sum, 13_300);
  assert.equal(day2.orders_fbs_count, 1, "задание без строки Статистики — всё равно FBS");
  assert.equal(day2.orders_fbw_count, 2);
  assert.equal(day3.orders_fbs_count, undefined);
  assert.equal(day3.orders_fbw_count, undefined);
});

test("заданий больше заказов дня — FBW не уходит в минус, рубли не больше заказов", () => {
  const [row] = applyFbsSchemeSplit([skuRow(1, "2026-09-22", 2, 1_400)], tasks("2026-09-23", [["1|2026-09-22", 3]]), "2026-09-23");
  assert.equal(row.orders_fbs_count, 3);
  assert.equal(row.orders_fbw_count, 0);
  assert.equal(row.orders_fbs_sum, 1_400);
  assert.equal(row.orders_fbw_sum, 0);
});

test("без синка заданий разбивка не выдумывается", () => {
  // Без курсора синка заданий базовые строки схему не несут — и не получают её.
  const [row] = applyFbsSchemeSplit([skuRow(1, "2026-09-22", 2, 1_400)], tasks(null, []), "2026-09-23");
  assert.equal(row.orders_fbs_count, undefined);
  assert.equal(row.orders_fbw_count, undefined);
});

test("сводка из тех же строк = сумма артикулов, FBW + FBS = «Заказы»", () => {
  const split = applyFbsSchemeSplit([
    skuRow(1, "2026-09-22", 2, 1_400),
    skuRow(2, "2026-09-22", 5, 5_000),
  ], tasks("2026-09-23", [["1|2026-09-22", 3]]), "2026-09-23");
  const sum = (key: keyof Row) => split.reduce((acc, row) => acc + Number(row[key] ?? 0), 0);
  const summary = buildMetrics(DAYS, AS_OF, new Map([["2026-09-22", {
    d: "2026-09-22",
    orders_count: sum("orders_count"),
    orders_sum: sum("orders_sum"),
    buyouts_count: 0,
    buyouts_sum: 0,
    ad_spent: 0,
    orders_fbs_count: sum("orders_fbs_count"),
    orders_fbs_sum: sum("orders_fbs_sum"),
    orders_fbw_count: sum("orders_fbw_count"),
    orders_fbw_sum: sum("orders_fbw_sum"),
  }]]), 0, 0, { ...CUTOFFS, scheme: "2026-09-22" });
  const skuFbw = split.reduce((acc, row) => acc + Number(row.orders_fbw_count ?? 0), 0);
  assert.equal(find(summary, "orders_fbw_count").daily[0], skuFbw);
  assert.equal((find(summary, "orders_fbs_sum").daily[0] ?? 0) + (find(summary, "orders_fbw_sum").daily[0] ?? 0), 6_400);
  // После границы схемы в сводке — «—», а не ноль.
  assert.equal(find(summary, "orders_fbw_count").daily[1], null);
});

test("день после воронки (сегодня): схема молчит — задания свежие, заказы из отстающей Статистики", () => {
  // Воронка по 22.09; 23.09 — заказы из Статистики (30), а заданий уже 24.
  const [closed, today] = applyFbsSchemeSplit([
    skuRow(1, "2026-09-22", 60, 60_000),
    skuRow(1, "2026-09-23", 30, 30_000, { fbs: 12, fbw: 18 }),
  ], tasks("2026-09-23", [["1|2026-09-22", 24], ["1|2026-09-23", 24]]), "2026-09-22");
  assert.equal(closed.orders_fbw_count, 36);
  assert.equal(today.orders_fbs_count, undefined, "было бы FBS 24 / FBW 6 / доля 80% при реальных 40%");
  // И в метриках: сводка нескольких кабинетов тоже гасит запасные дни.
  const list = buildMetrics(DAYS, AS_OF, new Map([
    ["2026-09-22", { d: "2026-09-22", orders_count: 60, orders_sum: 60_000, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0, orders_fbs_count: 24, orders_fbs_sum: 24_000, orders_fbw_count: 36, orders_fbw_sum: 36_000 }],
    ["2026-09-23", { d: "2026-09-23", orders_count: 30, orders_sum: 30_000, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0, orders_fbs_count: 24, orders_fbs_sum: 24_000, orders_fbw_count: 6, orders_fbw_sum: 6_000 }],
  ]), 0, 0, { ...CUTOFFS, ordersPrimary: "2026-09-22", scheme: "2026-09-23" });
  assert.deepEqual(find(list, "orders_fbw_count").daily, [36, null]);
  assert.deepEqual(find(list, "fbs_share_pct").daily, [40, null]);
});

test("кабинет без воронки: прежняя разбивка по строкам Статистики остаётся", () => {
  const [row] = applyFbsSchemeSplit([skuRow(1, "2026-09-22", 5, 5_000, { fbs: 1, fbw: 4 })], tasks("2026-09-23", [["1|2026-09-22", 2]]), null);
  assert.equal(row.orders_fbs_count, 1);
  assert.equal(row.orders_fbw_count, 4);
});

test("под фильтром кабинет без продаж не гасит цену выкупа остальных", () => {
  const withSales = { metrics: metrics() };
  const noSales = { metrics: buildMetrics(DAYS, AS_OF, new Map(), 0, 0, { ...CUTOFFS, sales: null }, 0, null, 7, { primaryFacts: true }) };
  const summary = metrics();
  const composed = composeRnpSummaryFromSkus(summary, [withSales, noSales], 7);
  const price = find(composed, "avg_buyout_price");
  assert.equal(price.daily[0], Math.round(13_289.47 / 51));
  assert.equal(price.total, find(summary, "avg_buyout_price").total);
  // Части — по выбранным строкам, а не шаблонные по всему кабинету.
  assert.deepEqual(price.parts?.denominator, [51, 43]);
});

test("два кабинета с разным днём воронки: сводка под фильтром = сводка без фильтра", () => {
  const days3 = ["2026-09-27", "2026-09-28", "2026-09-29"];
  const cabinet = (nm: number, ordersPrimary: string) => {
    const rows = applyFbsSchemeSplit(
      days3.map((d) => skuRow(nm, d, 10, 10_000)),
      tasks("2026-09-29", days3.map((d) => [`${nm}|${d}`, nm === 1 ? 4 : 1] as [string, number])),
      ordersPrimary,
    );
    const cutoffs = { orders: "2026-09-29", sales: "2026-09-29", adverts: "2026-09-29", ordersPrimary, scheme: "2026-09-29" };
    return { rows, metrics: buildMetrics(days3, "2026-09-29", new Map(rows.map((row) => [row.d, row])), 0, 0, cutoffs) };
  };
  // Воронка у A — по 28.09, у B — по 29.09.
  const a = cabinet(1, "2026-09-28");
  const b = cabinet(2, "2026-09-29");
  const byDay = new Map<string, Row>();
  for (const row of [...a.rows, ...b.rows]) {
    const current = (byDay.get(row.d) ?? { d: row.d, orders_count: 0, orders_sum: 0, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0 }) as unknown as Record<string, number | string>;
    for (const key of ["orders_count", "orders_sum", "orders_fbs_count", "orders_fbs_sum", "orders_fbw_count", "orders_fbw_sum"] as const) {
      if (row[key] != null) current[key] = Number(current[key] ?? 0) + Number(row[key]);
    }
    byDay.set(row.d, current as unknown as Row);
  }
  // Сводка кабинетов: день неполный, если хоть один берёт его из Статистики.
  const summary = buildMetrics(days3, "2026-09-29", byDay, 0, 0, { orders: "2026-09-29", sales: "2026-09-29", adverts: "2026-09-29", ordersPrimary: "2026-09-28", scheme: "2026-09-29" });
  const skus = [{ nm: 1, metrics: a.metrics }, { nm: 2, metrics: b.metrics }];
  const composed = composeRnpSummaryFromSkus(summary, skus, 7);
  for (const field of ["orders_fbs_count", "orders_fbw_count", "orders_fbw_sum", "fbs_share_pct"]) {
    assert.deepEqual(find(composed, field).daily, find(summary, field).daily, `${field}: по дням`);
    assert.equal(find(composed, field).total, find(summary, field).total, `${field}: итог`);
  }
  assert.equal(find(summary, "orders_fbs_count").daily[2], null, "29.09 у A — из Статистики, схема молчит");
  const week = composeRnpWeeklySummaryFromDailySkus({ period: days3.map((d) => ({ label: d.slice(8), period_type: "день" })), summary, skus }, new Set([1, 2]), 7, "2026-09-27", "2026-09-29");
  const unfilteredWeek = aggregateRnpWeekly({ period: days3.map((d) => ({ label: d.slice(8), period_type: "день" })), summary, skus: [] }, "2026-09-27", "2026-09-29").summary;
  assert.deepEqual(find(week, "fbs_share_pct").daily, find(unfilteredWeek, "fbs_share_pct").daily);
});
