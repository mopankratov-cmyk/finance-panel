import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  appendAdEfficiencyMetrics,
  appendCartOrderConversion,
  appendOrderConversion,
  applyEconomyMetricCoverage,
  applyExpectedBuyouts,
  buildAdTypeMetrics,
  buildMetrics,
  buildReviewMetrics,
  cohortRowsFromPrimary,
  cohortSlices,
  computeAnchorBuyoutRates,
  loadBuyoutCohort,
  loadCohortPrimaryRows,
  expectedOption,
  funnelAliveFromSyncState,
  salesLoadedThrough,
  type BuyoutCohortRow,
  type Metric,
} from "../lib/rnp/buildTable";
import { aggregateRnpWeekly, anomalyDirection, metricDelta, RNP_VIEW_PRESETS, rnpPresetForFields, sanitizeMetricFields } from "../lib/rnp/operatingMatrix";
import { RNP_LEGACY_PRESET_FIELDS } from "../lib/rnp/legacyPresets";
import { composeRnpSummaryFromSkus, RNP_REVIEWS_READ_FAILED_NOTE } from "../lib/rnp/summaryFromSkus";
import { appendTaxMetrics } from "../lib/rnp/taxMetrics";
import type { WbSyncState } from "../lib/wb/syncState";

/**
 * Фаза 3 сверки РНП с Оптимой: новые метрики — корзина → заказ, эффективность
 * рекламы, ступени прибыли, отзывы с текстом, прогноз продаж.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const find = (list: Metric[], field: string) => list.find((item) => item.field === field)!;
const metric = (field: string, daily: (number | null)[], kind = "int", extra: Partial<Metric> = {}): Metric => ({
  field, label: field, kind, daily, total: null, forecast: null, coveragePct: 100, ...extra,
});
const DAYS = ["2026-09-22", "2026-09-23", "2026-09-24"];
const period = DAYS.map((d) => ({ label: d.slice(8), period_type: "день" }));

// ── Корзина → заказ ──────────────────────────────────────────────────────────

test("«Корзина → заказ» — заказы / корзины, день из Статистики не входит", () => {
  const list = [metric("open_card", [1000, 1000, null]), metric("cart", [100, 80, null]), metric("orders_count", [25, 40, 30])];
  appendOrderConversion(list);
  appendCartOrderConversion(list, { days: DAYS, ordersPrimary: "2026-09-23" });
  const cr = find(list, "cart_order_cr");
  assert.deepEqual(cr.daily, [25, 50, null]);
  assert.equal(cr.total, Math.round((65 / 180) * 1000) / 10);
  assert.ok(cr.parts);
  assert.equal(find(list, "order_cr").label, "Переход → заказ, %");
});

// ── Эффективность рекламы ────────────────────────────────────────────────────

const adSku = (spent: (number | null)[], clicks: (number | null)[], views: (number | null)[], orders: (number | null)[], ordersSum: (number | null)[]) => {
  const list = [metric("ad_spent", spent, "money"), metric("clicks", clicks), metric("views", views), metric("ad_orders", orders), metric("ad_orders_sum", ordersSum, "money")];
  appendAdEfficiencyMetrics(list);
  return list;
};

test("CPC с копейками, CPM ×1000, CPO и ACoS — из одного расхода", () => {
  const list = adSku([393, 1000, 0], [100, 250, null], [2000, 5000, null], [4, 10, null], [4000, 12500, null]);
  assert.deepEqual(find(list, "ad_cpc").daily, [3.93, 4, null], "до целого было бы 4 ₽ вместо 3,93 ₽");
  assert.equal(find(list, "ad_cpc").kind, "money2");
  assert.deepEqual(find(list, "ad_cpm").daily, [197, 200, null]);
  assert.deepEqual(find(list, "ad_cpo").daily, [98, 100, null]);
  assert.deepEqual(find(list, "ad_acos_pct").daily, [9.8, 8, null]);
  // Итог — из сумм: (393 + 1000) / 350 = 3,98.
  assert.equal(find(list, "ad_cpc").total, 3.98);
});

test("SKU без рекламы не гасит день у фильтра, копейки переживают неделю", () => {
  const withAds = adSku([393, 1000, 500], [100, 250, 100], [2000, 5000, 1000], [4, 10, 5], [4000, 12500, 5000]);
  const noAds = adSku([0, 0, 0], [null, null, null], [null, null, null], [null, null, null], [null, null, null]);
  const template = adSku([393, 1000, 500], [100, 250, 100], [2000, 5000, 1000], [4, 10, 5], [4000, 12500, 5000]);
  const composed = composeRnpSummaryFromSkus(template, [{ metrics: withAds }, { metrics: noAds }], 7);
  assert.deepEqual(find(composed, "ad_cpc").daily, [3.93, 4, 5]);
  const [week] = aggregateRnpWeekly({ period, summary: withAds, skus: [] }, "2026-09-22", "2026-09-28").summary
    .filter((item) => item.field === "ad_cpc").map((item) => item.daily);
  assert.deepEqual(week, [Math.round((1893 / 450) * 100) / 100]);
});

test("разрез по видам кампаний: CPC/CPM/CPO/ACoS только в сводке, с частями", () => {
  const buckets = new Map([["manual", new Map([["2026-09-22", { spent: 172.47, views: 1000, clicks: 44, orders: 2, ordersSum: 2400 }]])]]);
  const list = buildAdTypeMetrics(DAYS, "2026-09-24", buckets, 0, "2026-09-24");
  assert.equal(find(list, "ads_manual_cpc").daily[0], 3.92);
  assert.equal(find(list, "ads_manual_cpm").daily[0], 172);
  assert.equal(find(list, "ads_manual_cpo").daily[0], 86);
  assert.equal(find(list, "ads_manual_acos_pct").daily[0], 7.2);
  assert.equal(find(list, "ads_manual_cpc").daily[1], null, "день без кампаний — 0/0, а не 0 ₽");
  assert.ok(find(list, "ads_unified_cpc").parts);
});

// ── Ступени прибыли ──────────────────────────────────────────────────────────

const row = (d: string, extra: Record<string, number> = {}) => ({
  d, orders_count: 10, orders_sum: 10_000, buyouts_count: 5, buyouts_sum: 5_000, ad_spent: 500,
  returns_count: 0, returns_sum: 0, buyouts_gross_sum: 5_000, buyouts_finished_sum: 4_800, cancels_count: 1, cancels_sum: 1_000, ...extra,
});
const CUTOFFS = { orders: "2026-09-24", sales: "2026-09-24", adverts: "2026-09-24", ordersPrimary: "2026-09-24" };
const economy = (cost: number) => buildMetrics(DAYS, "2026-09-24", new Map(DAYS.map((d) => [d, row(d)])), 0, 0, CUTOFFS, cost, 30, 7, { primaryFacts: true });

test("валовая прибыль → прибыль до рекламы → прибыль после МП и рекламы, TACoS, СПП ₽", () => {
  const list = economy(400);
  assert.deepEqual(find(list, "gross_profit").daily, [3_000, 3_000, 3_000], "5 000 − 5 × 400");
  assert.equal(find(list, "gross_margin_pct").total, 60);
  // gross = 5 000 − 2 000 − 1 500 − 500 = 1 000; до рекламы — 1 500.
  assert.deepEqual(find(list, "gross").daily, [1_000, 1_000, 1_000]);
  assert.deepEqual(find(list, "profit_before_ads").daily, [1_500, 1_500, 1_500]);
  assert.equal(find(list, "tacos_pct").total, 10, "500 / 5 000");
  assert.equal(find(list, "spp_rub").total, 600, "(5 000 − 4 800) × 3");
});

test("без себестоимости ступени прибыли молчат, TACoS и СПП — нет", () => {
  const list = economy(0);
  assert.equal(find(list, "gross_profit").total, null);
  assert.equal(find(list, "gross_profit").qualityReason, "missing_cost");
  assert.equal(find(list, "profit_before_ads").total, null);
  assert.equal(find(list, "tacos_pct").total, 10);
});

test("под фильтром валовая маржа — только по SKU с себестоимостью", () => {
  const withCost = { metrics: economy(400) };
  const noCost = { metrics: economy(0) };
  const composed = composeRnpSummaryFromSkus(economy(400), [withCost, noCost], 7);
  assert.equal(find(composed, "gross_margin_pct").total, 60, "выкупы SKU без себестоимости не размывают маржу");
});

test("прибыль после комиссии кабинета — ступень между прибылью и налогом", () => {
  const list = [metric("buyouts_sum", [10_000], "money", { total: 10_000 }), metric("margin_pct", [30], "pct"), metric("gross", [3_000], "money", { total: 3_000 })];
  appendTaxMetrics(list, 5, { extraCommissionPct: 5 });
  assert.equal(find(list, "profit_after_agent").daily[0], 2_500, "3 000 − 5% от 10 000");
  assert.equal(find(list, "net_profit").daily[0], 2_000, "и ещё налог 5%");
});

// ── Отзывы ───────────────────────────────────────────────────────────────────

test("оценки и отзывы с текстом — отдельно; звёзды без текста не размывают оценку", () => {
  const list = buildReviewMetrics(DAYS, "2026-09-24", new Map([
    // 10 оценок: 8 пятёрок без текста и 2 отзыва с текстом — 5★ и 2★.
    ["2026-09-22", { count: 10, ratingSum: 47, bad: 1, textCount: 2, textRatingSum: 7, textBad: 1 }],
  ]));
  assert.equal(find(list, "reviews_count").label, "Оценки, шт.");
  assert.equal(find(list, "reviews_rating").total, 4.7);
  assert.equal(find(list, "reviews_text_count").total, 2);
  assert.equal(find(list, "reviews_text_rating").total, 3.5);
  assert.equal(find(list, "reviews_text_bad_share_pct").total, 50);
  assert.deepEqual(find(list, "reviews_text_count").daily, [2, 0, 0], "день без отзывов — честный ноль");
});

test("отзывы не прочитались — «—», а не «0 отзывов»", () => {
  const list = buildReviewMetrics(DAYS, "2026-09-24", new Map(), { unavailable: true });
  for (const field of ["reviews_count", "reviews_text_count", "reviews_rating"]) {
    assert.deepEqual(find(list, field).daily, [null, null, null], field);
    assert.equal(find(list, field).status, "unavailable", field);
  }
});

test("неделя: оценка отзывов с текстом взвешена их числом", () => {
  const list = buildReviewMetrics(DAYS, "2026-09-24", new Map([
    ["2026-09-22", { count: 5, ratingSum: 25, bad: 0, textCount: 1, textRatingSum: 5, textBad: 0 }],
    ["2026-09-23", { count: 5, ratingSum: 20, bad: 1, textCount: 3, textRatingSum: 6, textBad: 2 }],
  ]));
  const week = aggregateRnpWeekly({ period, summary: list, skus: [] }, "2026-09-22", "2026-09-28").summary;
  assert.deepEqual(find(week, "reviews_text_rating").daily, [2.75], "(5 + 6) / 4, а не среднее 5 и 2");
});

test("отзывы — по московским суткам, с текстом = текст, достоинства или недостатки", () => {
  const source = read("../lib/rnp/buildTable.ts");
  assert.match(source, /select\("nm_id, rating, created_at_wb, review_text, pros, cons"\)/);
  assert.match(source, /new Date\(at \+ MSK_OFFSET_MS\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(source, /\[r\.review_text, r\.pros, r\.cons\]\.some/);
});

// ── Прогноз продаж ───────────────────────────────────────────────────────────

const cohortRow = (d: string, nm: number, orders: number, kept: number, cancelled: number, returned: number): BuyoutCohortRow => ({
  d, nm_id: nm, cohort_orders: orders, cohort_cancelled: cancelled, cohort_kept: kept, cohort_kept_open: 0, cohort_returned: returned,
});
const anchorDays = Array.from({ length: 10 }, (_, index) => new Date(Date.UTC(2026, 7, 26 + index)).toISOString().slice(0, 10));
const anchor = {
  from: anchorDays[0],
  to: anchorDays[anchorDays.length - 1],
  rows: anchorDays.flatMap((d) => [
    // Дешёвый пенал: выкуп 80%. Дорогая куртка: выкуп 20%.
    cohortRow(d, 1, 10, 8, 2, 0),
    cohortRow(d, 2, 5, 1, 3, 1),
  ]),
};

test("ставка выкупа — по зрелым дням якоря, малый артикул тянется к кабинету", () => {
  const rates = computeAnchorBuyoutRates(anchor, null)!;
  // Кабинет: выкуплено (80 + 10 + 10) из 150 исходов.
  assert.equal(Math.round(rates.cabinet.gross * 1000) / 10, 66.7);
  const pencil = rates.byNm.get(1)!;
  const jacket = rates.byNm.get(2)!;
  assert.ok(pencil.gross > jacket.gross);
  assert.equal(Math.round(jacket.gross * 1000) / 1000, Math.round(((10 + 10 + 20 * (100 / 150)) / (50 + 20)) * 1000) / 1000);
  assert.equal(computeAnchorBuyoutRates({ ...anchor, rows: anchor.rows.slice(0, 4) }, null), null, "мало исходов — ставки нет");
});

test("прогноз: на днях из Статистики база включает отмены; без ставки — «—», а не 0", () => {
  const rates = computeAnchorBuyoutRates(anchor, null)!;
  const rows = applyExpectedBuyouts([
    { d: "2026-09-22", nm_id: 1, orders_count: 10, orders_sum: 3_000, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0, cancels_count: 2, cancels_sum: 600 },
    { d: "2026-09-24", nm_id: 1, orders_count: 10, orders_sum: 3_000, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0, cancels_count: 2, cancels_sum: 600 },
  ], rates, "2026-09-23");
  const rate = rates.byNm.get(1)!.gross;
  assert.equal(rows[0].expected_orders_base, 10, "день воронки: заказы уже с отменами");
  assert.equal(rows[1].expected_orders_base, 12, "день Статистики: + отмены");
  assert.equal(rows[1].expected_buyouts_count, 12 * rate);
  const withRate = buildMetrics(DAYS, "2026-09-24", new Map(rows.map((item) => [item.d, item])), 0, 0, CUTOFFS, 0, null, 7, { expectedBuyouts: expectedOption(rates, 1) });
  assert.ok((find(withRate, "expected_buyouts_count").total ?? 0) > 0);
  assert.match(find(withRate, "expected_buyouts_count").note ?? "", /Прогноз, не факт/);
  const noRate = buildMetrics(DAYS, "2026-09-24", new Map(rows.map((item) => [item.d, item])), 0, 0, CUTOFFS, 0, null, 7, {});
  assert.deepEqual(find(noRate, "expected_buyouts_count").daily, [null, null, null]);
  assert.equal(find(noRate, "expected_buyout_pct").qualityReason, "unsupported_source");
});

test("% выкупа (прогноз) — взвешен заказами: дорогие с низким выкупом тянут рубли вниз", () => {
  const rates = computeAnchorBuyoutRates(anchor, null)!;
  const rows = applyExpectedBuyouts([
    { d: "2026-09-22", nm_id: 1, orders_count: 10, orders_sum: 3_000, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0 },
    { d: "2026-09-22", nm_id: 2, orders_count: 10, orders_sum: 50_000, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0 },
  ], rates, "2026-09-24");
  const count = rows.reduce((acc, item) => acc + (item.expected_buyouts_count ?? 0), 0);
  const sum = rows.reduce((acc, item) => acc + (item.expected_buyouts_sum ?? 0), 0);
  assert.ok(sum / 53_000 < count / 20, "доля рублей ниже доли штук");
});

// ── Отображение копеек ───────────────────────────────────────────────────────

test("экран показывает CPC с копейками", () => {
  const page = read("../components/wb/WbRnpPage.tsx");
  assert.match(page, /if \(kind === "money2"\) return `\$\{\(Math\.round\(value \* 100\) \/ 100\)\.toLocaleString\("ru-RU", \{ minimumFractionDigits: 2, maximumFractionDigits: 2 \}\)\} ₽`;/);
});

// ── Исправления по ревью ─────────────────────────────────────────────────────

test("дельта CPC — в копейках, процент от настоящей разницы", () => {
  assert.deepEqual(metricDelta(3.98, 3.93, "money2"), { absolute: 0.05, percent: 1.3, direction: "up" });
  assert.equal(metricDelta(3.98, 3.93)?.direction, "flat", "без вида — прежнее округление до 0,1");
});

test("«Корзина → заказ»: день воронки без строки у артикула — ноль корзин, фильтр не гаснет", () => {
  const sku = (cart: (number | null)[], orders: number[]) => {
    const list = [metric("cart", cart), metric("orders_count", orders)];
    appendCartOrderConversion(list, { days: DAYS, ordersPrimary: "2026-09-24" });
    return { metrics: list };
  };
  const a = sku([100, 100, 100], [20, 20, 20]);
  const b = sku([null, null, null], [1, 1, 1]);
  const composed = composeRnpSummaryFromSkus(a.metrics, [a, b], 7);
  assert.deepEqual(find(composed, "cart_order_cr").daily, [21, 21, 21], "все заказы на те корзины, что есть — как у сводки");
});

test("прибыль до рекламы не пропадает, когда реклама отстаёт", () => {
  const list = buildMetrics(DAYS, "2026-09-24", new Map(DAYS.map((d) => [d, row(d)])), 0, 0, { ...CUTOFFS, adverts: "2026-09-23" }, 400, 30, 7, { primaryFacts: true });
  assert.deepEqual(find(list, "profit_before_ads").daily, [1_500, 1_500, 1_500]);
  assert.equal(find(list, "gross").daily[2], null, "а прибыль после рекламы за этот день молчит");
});

test("ставка прогноза не зависит от периода: окно режет только свежесть продаж", () => {
  const source = read("../lib/rnp/buildTable.ts");
  assert.match(source, /computeAnchorBuyoutRates\(item\.anchor, null\)/);
  assert.match(source, /const salesBound = salesFresh \? shiftIsoDays\(salesFresh, -ANCHOR_TO_DAYS\) : null;/);
  assert.doesNotMatch(source, /label: "RNP: когорта выкупа", maxPages: 100, concurrency/, "страница RPC — целый пересчёт, параллель тут втрое дороже");
});

test("сбой чтения отзывов — «ошибка источника», по кабинету", () => {
  const list = buildReviewMetrics(DAYS, "2026-09-24", new Map(), { unavailable: true });
  assert.equal(find(list, "reviews_count").qualityReason, "api_error");
  // Проводка по кабинетам — в tests/rnp-build-e2e.test.mts на настоящем buildRnpTable.
});

test("пояснение прогноза у SKU совпадает со сводкой — компактная передача его убирает", () => {
  const rates = computeAnchorBuyoutRates(anchor, null)!;
  assert.equal(expectedOption(rates)?.note, expectedOption(rates)?.note);
  const source = read("../lib/rnp/buildTable.ts");
  assert.match(source, /expectedByNm\.set\(Number\(total\.nm_id\), rates \? \(scopeData\.filter\(\(scopeItem\) => !scopeItem\.emptyScope\)\.length > 1 \? MULTI_CABINET_EXPECTED : expectedOption\(rates\)\) : null\);/);
});

// ── Второй раунд ревью ───────────────────────────────────────────────────────

test("кабинет без воронки не делит свои заказы на чужие корзины", () => {
  const withFunnel = [metric("cart", [100, 100, 100]), metric("orders_count", [20, 20, 20])];
  appendCartOrderConversion(withFunnel, { days: DAYS, ordersPrimary: "2026-09-24" });
  const noFunnel = [metric("cart", [null, null, null]), metric("orders_count", [5, 5, 5])];
  appendCartOrderConversion(noFunnel, { days: DAYS, ordersPrimary: null });
  assert.deepEqual(find(noFunnel, "cart_order_cr").daily, [null, null, null]);
  const composed = composeRnpSummaryFromSkus(withFunnel, [{ metrics: withFunnel }, { metrics: noFunnel }], 7);
  assert.deepEqual(find(composed, "cart_order_cr").daily, [20, 20, 20], "а не (20 + 5) / 100");
  assert.match(read("../lib/rnp/buildTable.ts"), /«Корзина → заказ» сводки — сумма частей SKU/);
});

test("отзывы под фильтром: кабинет с ошибкой чтения — «—», только здоровые — «готово»", () => {
  const healthy = { metrics: buildReviewMetrics(DAYS, "2026-09-24", new Map([["2026-09-22", { count: 4, ratingSum: 18, bad: 0, textCount: 1, textRatingSum: 4, textBad: 0 }]])) };
  const failed = { metrics: buildReviewMetrics(DAYS, "2026-09-24", new Map(), { unavailable: true }) };
  const template = buildReviewMetrics(DAYS, "2026-09-24", new Map(), { unavailable: true });
  const both = composeRnpSummaryFromSkus(template, [healthy, failed], 7);
  assert.equal(find(both, "reviews_count").total, null);
  assert.equal(find(both, "reviews_rating").total, null);
  const onlyHealthy = composeRnpSummaryFromSkus(template, [healthy], 7);
  assert.equal(find(onlyHealthy, "reviews_count").total, 4);
  assert.equal(find(onlyHealthy, "reviews_count").status, "ready");
});

test("сводка: прибыль после комиссии — с выкупов SKU с себестоимостью, равна сумме SKU", () => {
  const summary = [
    metric("buyouts_sum", [20_000], "money", { total: 20_000 }),
    // Прибыль знает только SKU с себестоимостью: его выкупы — 10 000.
    metric("margin_pct", [30], "pct", { weeklyParts: { numerator: [3_000], denominator: [10_000], scale: 100 } }),
    metric("gross", [3_000], "money", { total: 3_000 }),
  ];
  appendTaxMetrics(summary, 0, { extraCommissionPct: 5 });
  assert.equal(find(summary, "profit_after_agent").daily[0], 2_500, "3 000 − 5% от 10 000, а не от 20 000");
  assert.equal(find(summary, "agent_commission_rub").daily[0], 1_000, "строка комиссии — со всех выкупов");
});

const syncState = (patch: Partial<WbSyncState> & { state?: Record<string, unknown> }): WbSyncState => ({
  cursor: null, status: "caught_up", attempts: 0, lastError: null, updatedAt: "2026-09-30T09:00:00Z", ...patch, state: patch.state ?? {},
});

test("прогноз не пропадает от 429 в синке продаж, сбой якоря не стирает когорту периода", () => {
  // 429 после догнанного прохода: продажи загружены по дату того прохода.
  const rateLimited = syncState({ status: "running", lastError: "WB 429", state: { caughtUp: true, lastSyncedAt: "2026-09-29T21:30:00Z" } });
  assert.equal(salesLoadedThrough(rateLimited, "2026-09-30"), "2026-09-30", "21:30 UTC — уже 30-е по Москве");
  const source = read("../lib/rnp/buildTable.ts");
  assert.match(source, /const salesFresh = salesLoadedThrough\(salesState, today\);/);
});

// ── Живая проверка на проде ──────────────────────────────────────────────────

// Поддельный PostgREST над строками в памяти: фильтры, проекция колонок,
// порядок (строки перемешаны — порядок даёт только order) и страницы не больше
// 1000 строк — как у настоящего. Плюс учёт вызовов: проверяем путь, а не текст.
type FakeRow = Record<string, unknown>;
interface FakePage { table: string; filters: string[]; order: string[]; ids: unknown[] }
function fakeDb(tables: Record<string, FakeRow[]>, options: { fail?: (table: string, filters: string[]) => boolean; srid?: string | null; salesState?: FakeRow | null; delayMs?: number; delay?: (table: string, filters: string[]) => number } = {}) {
  // started — каждый отправленный запрос, даже оборванный до ответа; pages — отвеченные.
  const calls: { rpc: string[]; pages: FakePage[]; issued: number; started: Array<{ table: string; filters: string[] }> } = { rpc: [], pages: [], issued: 0, started: [] };
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const query = (table: string) => {
    const filters: string[] = [];
    const shuffled = [...(tables[table] ?? [])];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    let rows = shuffled;
    let columns: string[] | null = null;
    const order: Array<{ field: string; ascending: boolean }> = [];
    let range: [number, number] = [0, 999];
    let signal: AbortSignal | null = null;
    const at = (value: unknown) => Date.parse(String(value));
    const builder = {
      select: (list: string) => { columns = list.split(",").map((column) => column.trim()); return builder; },
      eq: (field: string, value: unknown) => { filters.push(`${field}=${value}`); rows = rows.filter((row) => row[field] === value); return builder; },
      in: (field: string, values: unknown[]) => { filters.push(`${field} in ${values.join("|")}`); rows = rows.filter((row) => values.includes(row[field])); return builder; },
      gte: (field: string, value: string) => { filters.push(`${field}>=${value}`); rows = rows.filter((row) => at(row[field]) >= at(value)); return builder; },
      lt: (field: string, value: string) => { filters.push(`${field}<${value}`); rows = rows.filter((row) => at(row[field]) < at(value)); return builder; },
      not: (field: string, op: string, value: unknown) => {
        assert.equal(op, "is"); assert.equal(value, null);
        filters.push(`${field} not null`); rows = rows.filter((row) => row[field] != null); return builder;
      },
      order: (field: string, spec: { ascending: boolean }) => { order.push({ field, ascending: spec.ascending }); return builder; },
      range: (from: number, to: number) => { range = [from, Math.min(to, from + 999)]; return builder; },
      abortSignal: (value: AbortSignal) => { signal = value; return builder; },
      maybeSingle: () => Promise.resolve({ data: table === "wb_sync_state" ? options.salesState ?? null : null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => {
        const abortedResult = { data: null, error: { message: "AbortError: This operation was aborted" } };
        if (signal?.aborted) return Promise.resolve(abortedResult).then(resolve, reject);
        const delayed = options.delay?.(table, filters) ?? options.delayMs ?? 0;
        calls.started.push({ table, filters: [...filters] });
        if (delayed) {
          calls.issued += 1;
          const settle = (builder as unknown as { answer: () => unknown }).answer;
          return new Promise((done) => {
            const timer = setTimeout(() => done(settle()), delayed);
            signal?.addEventListener("abort", () => { clearTimeout(timer); done(abortedResult); });
          }).then(resolve, reject);
        }
        calls.issued += 1;
        return Promise.resolve((builder as unknown as { answer: () => unknown }).answer()).then(resolve, reject);
      },
      answer: () => {
        if (options.fail?.(table, filters)) {
          calls.pages.push({ table, filters, order: order.map((item) => item.field), ids: [] });
          return { data: null, error: { message: "permission denied" } };
        }
        const sorted = [...rows].sort((a, b) => {
          for (const { field, ascending } of order) {
            const x = field === "date" ? at(a[field]) : Number(a[field]);
            const y = field === "date" ? at(b[field]) : Number(b[field]);
            if (x !== y) return ascending ? x - y : y - x;
          }
          return 0;
        });
        const page = sorted.slice(range[0], range[1] + 1);
        calls.pages.push({ table, filters, order: order.map((item) => item.field), ids: page.map((row) => row.id) });
        const projected = columns ? page.map((row) => Object.fromEntries(columns!.map((column) => [column, row[column]]))) : page;
        return { data: projected, error: null };
      },
    };
    return builder;
  };
  const db = {
    from: (table: string) => query(table),
    rpc: (name: string) => {
      calls.rpc.push(name);
      if (name === "rnp_sales_srid_since") return Promise.resolve({ data: options.srid === undefined ? "2026-01-01" : options.srid, error: null });
      const chain = { order: () => chain, range: () => Promise.resolve({ data: [], error: null }) };
      return chain;
    },
  };
  return { db: db as unknown as Parameters<typeof loadBuyoutCohort>[0], calls };
}

// Часы тестов фиксированы: иначе сборка около полуночи по Москве разъезжалась бы
// между «сегодня» теста и «сегодня» загрузчика.
const today = "2026-09-30";
const NOW = Date.parse("2026-09-30T12:00:00Z");
const clock = { today, nowMs: NOW };
function shiftDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const ago = (days: number, hour = 12) => `${shiftDays(today, -days)}T${String(hour).padStart(2, "0")}:00:00+00:00`;
const CAB = "cab-1";
const scope = (allowed: number[] | null) => ({ cabinetId: CAB, label: "тест", allowedNmIds: allowed ? new Set(allowed) : null }) as Parameters<typeof loadBuyoutCohort>[1];
const syncedState = (lastSyncedAt: string) => ({ cursor: null, status: "caught_up", attempts: 0, last_error: null, state: { caughtUp: true, lastSyncedAt }, updated_at: lastSyncedAt });
const caughtUp = syncedState("2026-09-30T11:00:00Z");
// Заказы на каждый день окна: каждый четвёртый отменён, нечётные выкуплены
// (через два дня), прочие в пути. Плюс строки-приманки: тот же артикул в чужом
// кабинете и чужой артикул в своём — фильтры должны их отсечь.
function cohortTables(daysBack: number, perDay: number) {
  const orders: FakeRow[] = [];
  const sales: FakeRow[] = [];
  let id = 0;
  for (let back = daysBack; back >= 0; back--) {
    for (let index = 0; index < perDay; index++) {
      id += 1;
      const srid = `o${id}`;
      const cancel = index % 4 === 0;
      orders.push({ id, cabinet_id: CAB, nm_id: 7, srid, date: ago(back, index % 24), is_cancel: cancel });
      if (!cancel && index % 2 === 1) sales.push({ id, cabinet_id: CAB, nm_id: 7, srid, sale_id: `S${id}`, date: ago(Math.max(0, back - 2)) });
    }
    for (const [cabinet, nm] of [["cab-2", 7], [CAB, 8]] as const) {
      id += 1;
      orders.push({ id, cabinet_id: cabinet, nm_id: nm, srid: `x${id}`, date: ago(back), is_cancel: false });
      sales.push({ id, cabinet_id: cabinet, nm_id: nm, srid: `x${id}`, sale_id: `S${id}`, date: ago(back) });
    }
  }
  return { wb_orders: orders, wb_sales: sales };
}
// Границы кусков, которыми читалась таблица: [from, to), to = null — без верхней границы.
const sliceBounds = (pages: FakePage[], table: string) => {
  const bounds = new Map<string, string | null>();
  for (const page of pages.filter((item) => item.table === table)) {
    const from = page.filters.find((filter) => filter.startsWith("date>="))!.slice(6, 16);
    const to = page.filters.find((filter) => filter.startsWith("date<"))?.slice(5, 15) ?? null;
    bounds.set(from, to);
  }
  return [...bounds].sort(([a], [b]) => a.localeCompare(b));
};
/** Куски идут встык, не длиннее недели, и покрывают [from, to). */
const assertCovers = (bounds: Array<[string, string | null]>, from: string, to: string | null) => {
  assert.equal(bounds[0][0], from, "первый кусок — с начала окна");
  for (let index = 0; index < bounds.length; index++) {
    const [start, end] = bounds[index];
    if (index < bounds.length - 1) assert.equal(end, bounds[index + 1][0], "куски встык");
    if (end) assert.ok(shiftDays(start, 7) >= end, `кусок ${start}…${end} не длиннее недели`);
  }
  assert.equal(bounds.at(-1)![1], to, "последний кусок — до конца окна");
};
const sum = <Row extends object>(rows: Row[], field: keyof Row) => rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
const days = (rows: Array<{ d: string }>) => [...new Set(rows.map((row) => row.d))].sort();

test("якорь и период — из первичных строк: без функции когорты, одним чтением, когда рядом", async () => {
  const { db, calls } = fakeDb(cohortTables(40, 30), { salesState: caughtUp });
  const { cohort, anchor } = await loadBuyoutCohort(db, scope([7]), [7], shiftDays(today, -6), today, clock);
  assert.deepEqual(calls.rpc, ["rnp_sales_srid_since"], "функция когорты не вызывается");
  assert.ok(anchor, "якорь есть");
  assert.equal(anchor.from, shiftDays(today, -35));
  assert.equal(anchor.to, shiftDays(today, -6));
  assert.deepEqual(days(anchor.rows), Array.from({ length: 30 }, (_, index) => shiftDays(today, -35 + index)));
  const rates = computeAnchorBuyoutRates(anchor, null)!;
  // За день: 8 отмен, 15 выкупов, 7 в пути — ставка 15 / (15 + 8), заказы в пути не в счёт.
  assert.equal(rates.cabinet.gross, 15 / 23);
  assert.ok(cohort);
  assert.deepEqual(days(cohort.rows), Array.from({ length: 7 }, (_, index) => shiftDays(today, -6 + index)));
  assert.ok(cohort.rows.every((row) => row.nm_id === 7), "чужой кабинет и чужой артикул отсечены");
  assert.equal(sum(cohort.rows, "cohort_orders"), 7 * 30);
  // Одно чтение на оба: окно заказов — от начала якоря до конца периода.
  assert.ok(calls.pages.filter((page) => page.table === "wb_orders").length > 1, "окно больше страницы — читается страницами");
  assertCovers(sliceBounds(calls.pages, "wb_orders"), shiftDays(today, -35), shiftDays(today, 1));
  // Продажи — с начала окна и без верхней границы в последнем куске.
  assertCovers(sliceBounds(calls.pages, "wb_sales"), shiftDays(today, -35), null);
});

test("склейка окон: квартал и период внутри якоря читаются по своим границам", async () => {
  const tables = cohortTables(95, 4);
  const quarter = fakeDb(tables, { salesState: caughtUp });
  const q = await loadBuyoutCohort(quarter.db, scope([7]), [7], shiftDays(today, -89), today, clock);
  assert.equal(days(q.cohort!.rows).length, 90);
  assert.equal(days(q.anchor!.rows).length, 30);
  assertCovers(sliceBounds(quarter.calls.pages, "wb_orders"), shiftDays(today, -89), shiftDays(today, 1));
  const inside = fakeDb(tables, { salesState: caughtUp });
  const i = await loadBuyoutCohort(inside.db, scope([7]), [7], shiftDays(today, -40), shiftDays(today, -20), clock);
  assert.deepEqual(days(i.cohort!.rows), Array.from({ length: 21 }, (_, index) => shiftDays(today, -40 + index)));
  assert.equal(days(i.anchor!.rows).at(-1), shiftDays(today, -6));
});

test("сбой чтения периода не гасит якорь, сбой якоря — период", async () => {
  const periodFrom = shiftDays(today, -60);
  const tables = cohortTables(70, 5);
  const periodFails = fakeDb(tables, { salesState: caughtUp, fail: (table, filters) => table === "wb_orders" && filters.includes(`date>=${periodFrom}T00:00:00.000Z`) });
  const a = await loadBuyoutCohort(periodFails.db, scope([7]), [7], periodFrom, shiftDays(today, -55), clock);
  assert.equal(a.cohort, null, "период молчит, а не рисует ноль");
  assert.ok(a.anchor && a.anchor.rows.length > 0, "якорь на месте");
  const anchorFails = fakeDb(tables, { salesState: caughtUp, fail: (table, filters) => table === "wb_sales" && filters.includes(`date>=${shiftDays(today, -35)}T00:00:00.000Z`) });
  const b = await loadBuyoutCohort(anchorFails.db, scope([7]), [7], periodFrom, shiftDays(today, -55), clock);
  assert.equal(b.anchor, null);
  assert.equal(days(b.cohort!.rows).length, 6);
});

test("общее чтение соседних окон упало — период и якорь читаются по отдельности", async () => {
  // Падает всё, что начинается с якоря (в том числе общее чтение), — неделя выживает.
  const { db, calls } = fakeDb(cohortTables(40, 5), { salesState: caughtUp, fail: (table, filters) => table === "wb_orders" && filters.includes(`date>=${shiftDays(today, -35)}T00:00:00.000Z`) });
  const { cohort, anchor } = await loadBuyoutCohort(db, scope([7]), [7], shiftDays(today, -6), today, clock);
  assert.equal(anchor, null);
  assert.equal(days(cohort!.rows).length, 7, "«% выкупа» недели не гаснет из-за якоря");
  assert.ok(calls.pages.some((page) => page.table === "wb_orders" && page.filters.includes(`date>=${shiftDays(today, -6)}T00:00:00.000Z`)));
});

test("якорь режется свежестью синка продаж и молчит без него", async () => {
  const tables = cohortTables(40, 5);
  const stale = await loadBuyoutCohort(fakeDb(tables, { salesState: syncedState("2026-09-25T08:00:00Z") }).db, scope([7]), [7], shiftDays(today, -6), today, clock);
  assert.equal(stale.anchor?.to, shiftDays("2026-09-25", -6));
  const noSync = await loadBuyoutCohort(fakeDb(tables, { salesState: null }).db, scope([7]), [7], shiftDays(today, -6), today, clock);
  assert.equal(noSync.anchor, null);
  assert.equal(days(noSync.cohort!.rows).length, 7);
});

test("кабинет без списка артикулов — тоже из первичных строк, все его артикулы, без якоря", async () => {
  const { db, calls } = fakeDb(cohortTables(40, 3), { salesState: caughtUp });
  const { cohort, anchor } = await loadBuyoutCohort(db, scope(null), null, shiftDays(today, -6), today, clock);
  assert.deepEqual(calls.rpc, ["rnp_sales_srid_since"], "функция когорты не вызывается");
  assert.equal(anchor, null, "прогнозу нужны отмены — их знают только кабинеты со списком");
  assert.ok(calls.pages.every((page) => !page.filters.some((filter) => filter.startsWith("nm_id in"))), "без фильтра по артикулам");
  assert.deepEqual([...new Set(cohort!.rows.map((row) => row.nm_id))].sort(), [7, 8], "чужой кабинет отсечён, свои артикулы — все");
  assert.equal(sum(cohort!.rows.filter((row) => row.nm_id === 8), "cohort_kept"), 7);
  assertCovers(sliceBounds(calls.pages, "wb_orders"), shiftDays(today, -6), shiftDays(today, 1));
});

test("крупный кабинет (СЛОЁНО, ~3,5 тыс. заказов в день): месяц — недельными кусками, смещения малые", async () => {
  const tables = cohortTables(30, 1_200);
  const { db, calls } = fakeDb(tables, { salesState: caughtUp });
  const { cohort } = await loadBuyoutCohort(db, scope(null), null, shiftDays(today, -29), today, clock);
  assert.equal(sum(cohort!.rows.filter((row) => row.nm_id === 7), "cohort_orders"), 30 * 1_200);
  assertCovers(sliceBounds(calls.pages, "wb_orders"), shiftDays(today, -29), shiftDays(today, 1));
  const orderPages = calls.pages.filter((page) => page.table === "wb_orders");
  const served = orderPages.flatMap((page) => page.ids);
  assert.equal(new Set(served).size, served.length, "без дублей");
  assert.equal(served.length, tables.wb_orders.filter((row) => row.cabinet_id === CAB && Date.parse(String(row.date)) >= Date.parse(`${shiftDays(today, -29)}T00:00:00Z`)).length, "без потерь");
  // Куски по неделе: страниц в куске не больше, чем влезает недельный объём.
  const pagesPerSlice = new Map<string, number>();
  for (const page of orderPages) {
    const from = page.filters.find((filter) => filter.startsWith("date>="))!;
    pagesPerSlice.set(from, (pagesPerSlice.get(from) ?? 0) + 1);
  }
  assert.ok(Math.max(...pagesPerSlice.values()) <= Math.ceil((7 * 1_202) / 1_000) + 1);
});

test("прошлый период: продажи — неделями до сегодня, а не одним куском; дни до srid не читаются", async () => {
  const tables = cohortTables(70, 40);
  const past = fakeDb(tables, { salesState: caughtUp });
  await loadBuyoutCohort(past.db, scope(null), null, shiftDays(today, -60), shiftDays(today, -55), clock);
  const sales = sliceBounds(past.calls.pages, "wb_sales");
  assertCovers(sales, shiftDays(today, -60), null);
  assert.ok(sales.at(-1)![0] >= shiftDays(today, -6), "открытый кусок — только последняя неделя");
  const since = shiftDays(today, -10);
  const beforeSrid = fakeDb(tables, { salesState: caughtUp, srid: shiftDays(since, -1) });
  const result = await loadBuyoutCohort(beforeSrid.db, scope(null), null, shiftDays(today, -30), shiftDays(today, -20), clock);
  assert.deepEqual(result.cohort?.rows, []);
  assert.equal(beforeSrid.calls.pages.length, 0, "период целиком до since — ничего не читаем");
});

test("первый сбой обрывает остальные чтения: ни одного нового запроса после отказа", async () => {
  const tables = cohortTables(30, 1_200);
  const { db, calls } = fakeDb(tables, { delayMs: 3, fail: (table, filters) => table === "wb_orders" && filters.includes(`date>=${shiftDays(today, -22)}T00:00:00.000Z`) });
  await assert.rejects(loadCohortPrimaryRows(db, CAB, null, shiftDays(today, -29), today, NOW));
  const atFailure = calls.issued;
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(calls.issued, atFailure, "после отказа запросов не прибавилось");
  assert.ok(atFailure < 60, `прочитано ${atFailure} страниц из ~150`);
});

test("бюджет времени: медленная база даёт «—», а не таймаут роута", async () => {
  const { db, calls } = fakeDb(cohortTables(30, 1_200), { delayMs: 25 });
  const started = Date.now();
  await assert.rejects(loadCohortPrimaryRows(db, CAB, null, shiftDays(today, -29), today, NOW, 120), /бюджет|прервано|AbortError/);
  assert.ok(Date.now() - started < 1_000, "обрыв по бюджету, а не после всех страниц");
  const atAbort = calls.issued;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls.issued, atAbort);
});

test("куски окна: встык, по неделе, последний кусок продаж — без верхней границы", () => {
  assert.deepEqual(cohortSlices("2026-09-01", "2026-09-30", false), [
    { from: "2026-09-01", to: "2026-09-08" },
    { from: "2026-09-08", to: "2026-09-15" },
    { from: "2026-09-15", to: "2026-09-22" },
    { from: "2026-09-22", to: "2026-09-29" },
    { from: "2026-09-29", to: "2026-10-01" },
  ]);
  assert.deepEqual(cohortSlices("2026-09-23", "2026-09-30", true), [
    { from: "2026-09-23", to: "2026-09-30" },
    { from: "2026-09-30", to: null },
  ]);
  assert.deepEqual(cohortSlices("2026-09-30", "2026-09-30", false), [{ from: "2026-09-30", to: "2026-10-01" }]);
  assert.deepEqual(cohortSlices("2026-10-01", "2026-09-30", false), []);
});

test("дни до появления srid не читаются; нет srid вовсе — когорты нет", async () => {
  const since = shiftDays(today, -10);
  const { db, calls } = fakeDb(cohortTables(40, 3), { salesState: caughtUp, srid: shiftDays(since, -1) });
  const { cohort, anchor } = await loadBuyoutCohort(db, scope([7]), [7], shiftDays(today, -30), shiftDays(today, -20), clock);
  assert.equal(cohort?.since, since);
  assert.deepEqual(cohort?.rows, [], "период целиком до since");
  assert.equal(sliceBounds(calls.pages, "wb_orders")[0][0], since, "якорь режется по since");
  assert.equal(anchor?.from, since);
  const none = await loadBuyoutCohort(fakeDb({}, { srid: null }).db, scope([7]), [7], today, today, clock);
  assert.deepEqual(none, { cohort: null, anchor: null });
});

test("страницы — по дате и id: каждая строка ровно один раз", async () => {
  const tables = cohortTables(3, 900);
  const { db, calls } = fakeDb(tables);
  const rows = await loadCohortPrimaryRows(db, CAB, [7], shiftDays(today, -3), today, NOW);
  assert.equal(sum(rows, "cohort_orders"), 3_600);
  assert.equal(sum(rows, "cohort_cancelled"), 900);
  assert.equal(sum(rows, "cohort_kept"), 1_800);
  for (const table of ["wb_orders", "wb_sales"]) {
    const pages = calls.pages.filter((page) => page.table === table);
    assert.ok(pages.length > 1, `${table}: несколько страниц`);
    assert.ok(pages.every((page) => page.order.join(",") === "date,id"), `${table}: порядок индекса (date, id)`);
    const served = pages.flatMap((page) => page.ids);
    assert.equal(new Set(served).size, served.length, `${table}: без дублей`);
  }
  const expectedOrders = tables.wb_orders.filter((row) => row.cabinet_id === CAB && row.nm_id === 7).length;
  assert.equal(calls.pages.filter((page) => page.table === "wb_orders").flatMap((page) => page.ids).length, expectedOrders, "без потерь");
});

test("строка, пришедшая дважды на стыке страниц, считается один раз", () => {
  const order = { id: 1, srid: "a", nm_id: 1, date: "2026-09-01T10:00:00+00:00", is_cancel: false };
  const rows = cohortRowsFromPrimary([order, { ...order }, { ...order, id: 2, srid: "b" }], [{ srid: "a", sale_id: "S1", date: "2026-09-03T10:00:00+00:00" }], NOW);
  assert.equal(rows[0].cohort_orders, 2);
  assert.equal(rows[0].cohort_kept, 1);
});

test("«ещё в окне возврата» — первая продажа моложе 21 дня, строго", () => {
  const day = 86_400_000;
  const stamp = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const orders = ["a", "b", "c", "d", "e"].map((srid, index) => ({ id: index, srid, nm_id: 1, date: "2026-08-01T10:00:00+00:00", is_cancel: false }));
  const rows = cohortRowsFromPrimary(orders, [
    { srid: "a", sale_id: "S1", date: stamp(20 * day) }, // открыт
    { srid: "b", sale_id: "S2", date: stamp(22 * day) }, // закрыт
    { srid: "c", sale_id: "S3", date: stamp(21 * day) }, // ровно 21 день — закрыт (в SQL строго >)
    { srid: "d", sale_id: "S4", date: stamp(25 * day) }, // первая продажа старая — закрыт
    { srid: "d", sale_id: "S5", date: stamp(2 * day) },
    { srid: "e", sale_id: "S6", date: stamp(1 * day) }, // выкуп и возврат — возврат
    { srid: "e", sale_id: "R6", date: stamp(0) },
  ], NOW);
  assert.deepEqual({ kept: rows[0].cohort_kept, open: rows[0].cohort_kept_open, returned: rows[0].cohort_returned }, { kept: 4, open: 1, returned: 1 });
});

test("свежие дни: все выкупы ещё в окне возврата, старые — уже нет", async () => {
  const { db } = fakeDb(cohortTables(40, 6), { salesState: caughtUp });
  const { cohort, anchor } = await loadBuyoutCohort(db, scope([7]), [7], shiftDays(today, -6), today, clock);
  assert.ok(sum(cohort!.rows, "cohort_kept") > 0);
  assert.equal(sum(cohort!.rows, "cohort_kept_open"), sum(cohort!.rows, "cohort_kept"));
  const old = anchor!.rows.filter((row) => row.d <= shiftDays(today, -25));
  assert.ok(sum(old, "cohort_kept") > 0);
  assert.equal(sum(old, "cohort_kept_open"), 0);
});

test("когорта из первичных строк — те же правила, что у rnp_buyout_cohort_daily_sku", () => {
  const orders = [
    { srid: "a", nm_id: 1, date: "2026-09-01T10:00:00+00:00", is_cancel: false }, // выкуп
    { srid: "b", nm_id: 1, date: "2026-09-01T23:30:00+00:00", is_cancel: false }, // выкуп и возврат → возврат
    { srid: "c", nm_id: 1, date: "2026-09-01T12:00:00+00:00", is_cancel: true }, // отмена, хоть продажа и пришла
    { srid: "d", nm_id: 1, date: "2026-09-01T12:00:00+00:00", is_cancel: null }, // в пути
    { srid: null, nm_id: 1, date: "2026-09-01T12:00:00+00:00", is_cancel: false }, // без srid — исход неизвестен
    { srid: "e", nm_id: "2", date: "2026-09-02T00:00:00+00:00", is_cancel: false }, // только возврат
  ];
  const sales = [
    { srid: "a", sale_id: "S1" },
    { srid: "b", sale_id: "S2" },
    { srid: "b", sale_id: "R2" },
    { srid: "c", sale_id: "S3" },
    { srid: "e", sale_id: "R4" },
    { srid: "x", sale_id: "S9" }, // продажа чужого заказа — не в когорте
    { srid: "d", sale_id: "D5" }, // не выкуп и не возврат
  ];
  const rows = cohortRowsFromPrimary(orders, sales);
  assert.deepEqual(rows.find((row) => row.d === "2026-09-01" && row.nm_id === 1), {
    d: "2026-09-01", nm_id: 1, cohort_orders: 5, cohort_cancelled: 1, cohort_kept: 1, cohort_kept_open: 0, cohort_returned: 1,
  });
  assert.deepEqual(rows.find((row) => row.nm_id === 2), {
    d: "2026-09-02", nm_id: 2, cohort_orders: 1, cohort_cancelled: 0, cohort_kept: 0, cohort_kept_open: 0, cohort_returned: 1,
  });
  assert.equal(rows.length, 2);
  // Ставка из этих строк считается тем же computeAnchorBuyoutRates.
  const sql = read("../supabase/migrations/202609170001_rnp_buyout_cohort_and_report_logistics.sql");
  assert.match(sql, /bool_or\(s\.sale_id like 'S%'\) as sold/);
  assert.match(sql, /bool_or\(s\.sale_id like 'R%'\) as returned/);
  assert.match(sql, /where not o\.is_cancel and coalesce\(f\.returned, false\)/);
});

// ── Третий раунд ревью ───────────────────────────────────────────────────────

test("синк продаж догоняет историю — якорь режет курсор, а не «сейчас»", () => {
  const backfill = syncState({ status: "backfill", cursor: "2026-08-16T10:00:00", state: { caughtUp: false, lastRowDate: "2026-08-16T10:00:00", lastSyncedAt: "2026-09-30T08:00:00Z" } });
  assert.equal(salesLoadedThrough(backfill, "2026-09-30"), "2026-08-16");
  // Ошибка посреди догонки: состояние сохраняет caughtUp=false от прошлого прохода.
  const failedBackfill = syncState({ status: "error", lastError: "WB 500", cursor: "2026-08-20T00:00:00", state: { caughtUp: false, lastSyncedAt: "2026-09-30T07:00:00Z" } });
  assert.equal(salesLoadedThrough(failedBackfill, "2026-09-30"), "2026-08-20");
  // Ни одного успешного прохода — updated_at двигают и отказы, ему не верим.
  assert.equal(salesLoadedThrough(syncState({ status: "error", lastError: "WB 401" }), "2026-09-30"), null);
  assert.equal(salesLoadedThrough(syncState({ status: "caught_up" }), "2026-09-30"), "2026-09-30");
  assert.equal(salesLoadedThrough(null, "2026-09-30"), null);
});

test("воронка посреди круга: корзины неизвестны — день сводки молчит, а не конверсия одного кабинета", () => {
  const a = [metric("cart", [100, 100, 100]), metric("orders_count", [20, 20, 20])];
  appendCartOrderConversion(a, { days: DAYS, ordersPrimary: "2026-09-24" });
  const b = [metric("cart", [null, null, null]), metric("orders_count", [30, 30, 30])];
  appendCartOrderConversion(b, { days: DAYS, ordersPrimary: null, funnelPending: true });
  assert.deepEqual(find(b, "cart_order_cr").parts?.numerator, [null, null, null]);
  const composed = composeRnpSummaryFromSkus(a, [{ metrics: a }, { metrics: b }], 7);
  assert.deepEqual(find(composed, "cart_order_cr").daily, [null, null, null]);
  // Воронки нет вовсе (ни одного успешного прохода) — прежнее 0/0.
  assert.equal(funnelAliveFromSyncState(syncState({ status: "error", lastError: "WB 401" }), "2026-09-30"), false);
  assert.equal(funnelAliveFromSyncState(null, "2026-09-30"), false);
  // Середина круга: успешный проход вчера, статус pending.
  assert.equal(funnelAliveFromSyncState(syncState({ status: "pending", state: { coveragePct: 33.3, lastSyncedAt: "2026-09-29T12:00:00Z" } }), "2026-09-30"), true);
  // Сломана давно — уже не «в пути».
  assert.equal(funnelAliveFromSyncState(syncState({ status: "error", lastError: "WB 401", state: { lastSyncedAt: "2026-09-01T12:00:00Z" } }), "2026-09-30"), false);
  assert.match(read("../lib/rnp/buildTable.ts"), /funnelPending: funnelPendingNm\.has\(t\.nm_id\)/);
});

test("отзывы под фильтром по здоровым SKU — пояснение без «строка молчит»", () => {
  const healthy = { metrics: buildReviewMetrics(DAYS, "2026-09-24", new Map([["2026-09-22", { count: 3, ratingSum: 14, bad: 0, textCount: 1, textRatingSum: 5, textBad: 0 }]])) };
  const template = buildReviewMetrics(DAYS, "2026-09-24", new Map(), { unavailable: true });
  assert.ok(find(template, "reviews_count").note?.includes(RNP_REVIEWS_READ_FAILED_NOTE));
  const composed = composeRnpSummaryFromSkus(template, [healthy], 7);
  for (const field of ["reviews_count", "reviews_rating", "reviews_bad_share_pct", "reviews_text_count", "reviews_text_rating", "reviews_text_bad_share_pct"]) {
    const row = find(composed, field);
    assert.equal(row.status, "ready", field);
    assert.ok(!row.note?.includes("строка молчит"), field);
    assert.ok(row.note?.includes("По дате создания отзыва"), `${field}: остальное пояснение на месте`);
  }
});

// ── Итоговое ревью всей цепочки ──────────────────────────────────────────────

test("прогноз под фильтром: дробные прогнозы артикулов не теряются при сложении", () => {
  // 50 артикулов по 0,03 возврата в день: округление дня артикула до 0,1 давало 0.
  const makeRows = (returns: number, count: number) => new Map(DAYS.map((d) => [d, {
    d, orders_count: count * 1, orders_sum: count * 1_000, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0,
    expected_buyouts_count: count * 0.3, expected_buyouts_sum: count * 300, expected_returns_count: returns, expected_orders_base: count * 1,
  }])) as unknown as Parameters<typeof buildMetrics>[2];
  const option = { expectedBuyouts: { note: "Прогноз, не факт" } };
  const skuMetrics = Array.from({ length: 50 }, () => ({ metrics: buildMetrics(DAYS, "2026-09-24", makeRows(0.03, 1), 0, 0, CUTOFFS, 0, null, 7, option) }));
  const summary = buildMetrics(DAYS, "2026-09-24", makeRows(1.5, 50), 0, 0, CUTOFFS, 0, null, 7, option);
  const composed = composeRnpSummaryFromSkus(summary, skuMetrics, 7);
  const returnsDaily = find(composed, "expected_returns_count").daily;
  for (const value of returnsDaily) assert.ok(Math.abs((value ?? 0) - 1.5) < 0.01, `день ${value} ≈ 1,5`);
  assert.equal(find(summary, "expected_returns_count").total, 5, "сервер: округление итога — один раз");
  assert.equal(find(composed, "expected_returns_count").total, find(summary, "expected_returns_count").total, "под фильтром «все» = без фильтра");
});

test("строки прогноза не дают сигналов роста и риска: они лишь повторяют заказы", () => {
  const up = metricDelta(15, 10)!;
  for (const field of ["expected_buyouts_count", "expected_buyouts_sum", "expected_returns_count"]) {
    assert.equal(anomalyDirection(field, up), null, field);
  }
  assert.equal(anomalyDirection("orders_count", up), "positive", "а заказы сигналят, как раньше");
});

test("прежний вариант пресета узнаётся и заменяется текущим; прочее — «Свой вариант»", () => {
  const salesNow = RNP_VIEW_PRESETS.find((view) => view.id === "sales")!.fields;
  assert.deepEqual(rnpPresetForFields(salesNow), { id: "sales", legacy: false });
  for (const [id, lists] of Object.entries(RNP_LEGACY_PRESET_FIELDS)) {
    for (const list of lists) {
      assert.deepEqual(rnpPresetForFields(sanitizeMetricFields(list, [])), { id, legacy: true }, `${id}: ${list.length} полей`);
    }
  }
  assert.deepEqual(rnpPresetForFields(["orders_count", "cart"]), { id: "custom", legacy: false });
  // Версия «Рекламы» до фазы 3 — без CPC и TACoS: узнаётся как «Реклама».
  assert.ok((RNP_LEGACY_PRESET_FIELDS.ads ?? []).some((list) => !list.includes("ad_cpc")));
  // Пресеты не должны совпадать друг с другом и с чужими прежними версиями.
  for (const view of RNP_VIEW_PRESETS) assert.equal(rnpPresetForFields(view.fields).id, view.id);
  const page = read("../components/wb/WbRnpPage.tsx");
  assert.match(page, /const preset = rnpPresetForFields\(preferences\.metricFields\);/);
  assert.match(page, /if \(presetFields\) setMetricFields\(\[\.\.\.presetFields\]\);/);
});

test("единицы: оценки — в звёздах, «шт.» с точкой не задваивается", () => {
  const toolbar = read("../components/wb/RnpOperatingToolbar.tsx");
  assert.match(toolbar, /reviews_rating: "★"/);
  assert.match(toolbar, /reviews_text_rating: "★"/);
  for (const source of [toolbar, read("../components/wb/WbRnpPage.tsx")]) {
    assert.doesNotMatch(source, /replace\(\/, \(₽\|%\|дней\|шт\)\$\/u/);
    const strip = (label: string) => label.replace(/, (₽|%|дней|шт\.?)$/u, "");
    assert.equal(strip("Оценки, шт."), "Оценки");
    assert.equal(strip("Продажи (прогноз), шт"), "Продажи (прогноз)");
  }
});

test("полная себестоимость — у прибыли сводки нет причины «нет себестоимости»; свежесть остаётся", () => {
  const full = metric("gross_profit", [100], "money", { total: 100, qualityReason: "missing_cost" });
  applyEconomyMetricCoverage(full, 100, "Себестоимость известна для 2 из 2 SKU.", undefined);
  assert.equal(full.qualityReason, undefined);
  const stale = metric("gross_profit", [100], "money", { total: 100, qualityReason: "stale_source" });
  applyEconomyMetricCoverage(stale, 100, "…", undefined);
  assert.equal(stale.qualityReason, "stale_source");
  const partial = metric("gross_profit", [100], "money", { total: 100 });
  applyEconomyMetricCoverage(partial, 50, "…", "missing_cost");
  assert.equal(partial.qualityReason, "missing_cost");
});

test("«Все кабинеты» под фильтром только по артикулам со ставкой: пояснение и статус — их, а не «прогноза нет»", () => {
  const noRateNote = "Ставки выкупа нет — прогноз молчит, а не показывает ноль.";
  const template = [
    metric("orders_count", [10, 10, 10]),
    metric("expected_buyouts_count", [null, null, null], "int", { status: "unavailable", coveragePct: 0, qualityReason: "unsupported_source", note: noRateNote }),
  ];
  const sku = (value: number, reason?: "unsupported_source") => ({ metrics: [
    metric("orders_count", [10, 10, 10]),
    metric("expected_buyouts_count", reason ? [null, null, null] : [value, value, value], "int", reason ? { status: "unavailable", coveragePct: 0, qualityReason: reason, note: noRateNote } : { status: "partial", coveragePct: 85.7, qualityReason: "stale_source", note: "Прогноз, не факт: сумма прогнозов артикулов" }),
  ] });
  const rated = composeRnpSummaryFromSkus(template, [sku(3), sku(4)], 7);
  const row = find(rated, "expected_buyouts_count");
  assert.deepEqual(row.daily, [7, 7, 7]);
  assert.equal(row.status, "partial");
  assert.equal(row.qualityReason, "stale_source");
  assert.match(row.note ?? "", /Прогноз, не факт/);
  const mixed = composeRnpSummaryFromSkus(template, [sku(3), sku(0, "unsupported_source")], 7);
  assert.equal(find(mixed, "expected_buyouts_count").qualityReason, "unsupported_source", "есть артикул без ставки — строка молчит");
  assert.deepEqual(find(mixed, "expected_buyouts_count").daily, [null, null, null]);
});

test("общее чтение упёрлось в бюджет — период перечитывается, якорь нет (он упёрся бы снова)", async () => {
  const anchorStart = `date>=${shiftDays(today, -35)}T00:00:00.000Z`;
  const { db, calls } = fakeDb(cohortTables(40, 5), { salesState: caughtUp, delay: (table, filters) => filters.includes(anchorStart) ? 400 : 1 });
  const { cohort, anchor } = await loadBuyoutCohort(db, scope([7]), [7], shiftDays(today, -6), today, { ...clock, budgetMs: 150 });
  assert.equal(anchor, null);
  assert.equal(days(cohort!.rows).length, 7, "«% выкупа» недели спасён отдельным чтением");
  const anchorReads = calls.started.filter((page) => page.table === "wb_orders" && page.filters.includes(anchorStart));
  assert.equal(anchorReads.length, 1, "окно с начала якоря читалось один раз — общим чтением, без повтора якоря");
  // Сбой данных (не бюджет) — якорь перечитывается, как раньше.
  const failing = fakeDb(cohortTables(40, 5), { salesState: caughtUp, fail: (table, filters) => table === "wb_orders" && filters.includes(anchorStart) && filters.some((filter) => filter === `date<${shiftDays(today, -28)}T00:00:00.000Z`) });
  await loadBuyoutCohort(failing.db, scope([7]), [7], shiftDays(today, -6), today, clock);
  assert.ok(failing.calls.pages.filter((page) => page.table === "wb_orders" && page.filters.includes(anchorStart)).length >= 2, "после сбоя данных якорь читается заново");
});

test("под фильтром оценка отзывов с текстом взвешена их числом, а не средняя по артикулам", () => {
  const skuA = { metrics: buildReviewMetrics(DAYS, "2026-09-24", new Map([["2026-09-22", { count: 2, ratingSum: 10, bad: 0, textCount: 1, textRatingSum: 5, textBad: 0 }]])) };
  const skuB = { metrics: buildReviewMetrics(DAYS, "2026-09-24", new Map([["2026-09-22", { count: 3, ratingSum: 6, bad: 3, textCount: 3, textRatingSum: 6, textBad: 3 }]])) };
  const template = buildReviewMetrics(DAYS, "2026-09-24", new Map([["2026-09-22", { count: 5, ratingSum: 16, bad: 3, textCount: 4, textRatingSum: 11, textBad: 3 }]]));
  const composed = composeRnpSummaryFromSkus(template, [skuA, skuB], 7);
  assert.equal(find(composed, "reviews_text_rating").daily[0], 2.75, "(5 + 6) / 4, а не (5 + 2) / 2");
  assert.equal(find(composed, "reviews_rating").daily[0], 3.2);
});

test("неделя у артикула: валовая маржа = Σ валовой прибыли / Σ выкупов, а не среднее дней", () => {
  const skuMetrics = [
    metric("buyouts_sum", [1_000, 3_000, null], "money"),
    metric("gross_profit", [100, 900, null], "money"),
    metric("gross_margin_pct", [10, 30, null], "pct"),
  ];
  const week = aggregateRnpWeekly({ period, summary: skuMetrics, skus: [{ nm: 1, metrics: skuMetrics }] } as never, "2026-09-22", "2026-09-28") as unknown as { skus: Array<{ metrics: Metric[] }> };
  assert.deepEqual(find(week.skus[0].metrics, "gross_margin_pct").daily, [25], "1000 / 4000, а не (10 + 30) / 2");
});
