import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  appendAdEfficiencyMetrics,
  appendCartOrderConversion,
  appendOrderConversion,
  applyExpectedBuyouts,
  buildAdTypeMetrics,
  buildMetrics,
  buildReviewMetrics,
  computeAnchorBuyoutRates,
  expectedOption,
  funnelAliveFromSyncState,
  salesLoadedThrough,
  type BuyoutCohortRow,
  type Metric,
} from "../lib/rnp/buildTable";
import { aggregateRnpWeekly, metricDelta } from "../lib/rnp/operatingMatrix";
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
  assert.match(source, /computeAnchorBuyoutRates\(item\.cohort\?\.anchor \?\? null, null\)/);
  assert.match(source, /const salesBound = salesFresh \? shiftIsoDays\(salesFresh, -ANCHOR_TO_DAYS\) : null;/);
  assert.doesNotMatch(source, /label: "RNP: когорта выкупа", maxPages: 100, concurrency/, "страница RPC — целый пересчёт, параллель тут втрое дороже");
});

test("сбой чтения отзывов — «ошибка источника», по кабинету", () => {
  const list = buildReviewMetrics(DAYS, "2026-09-24", new Map(), { unavailable: true });
  assert.equal(find(list, "reviews_count").qualityReason, "api_error");
  const source = read("../lib/rnp/buildTable.ts");
  assert.match(source, /unavailable: reviewsFailedNm\.has\(t\.nm_id\)/);
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
  assert.match(source, /load\(anchorFrom, anchorTo\)\.catch\(\(\) => null\)/);
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
