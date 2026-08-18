import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateMarginBeforeDrrPct, closedMoscowDates, glueSortedGroups, glueTotals, glueVerdict, loadSklejkiCommissionForCabinet, mapSklejkiMarginBeforeDrr, sklejkiPeriod, type SklejkiGroup, type SklejkiSkuMetrics } from "../lib/wb/sklejki";
import type { WbCommission } from "../lib/wb/commissions";

const sku = (patch: Partial<SklejkiSkuMetrics>): SklejkiSkuMetrics => ({
  nm: 1,
  art: "SKU-1",
  name: "Товар",
  img_url: "",
  shop: "Оптима",
  shows_7d: 0,
  orders_count_7d: 0,
  orders_sum_7d: 0,
  adv_spend_7d: 0,
  adv_spend_14d: 0,
  drr_7d: 0,
  margin_before_drr: null,
  stock: 0,
  signal: null,
  nm_rating: null,
  nm_feedbacks: null,
  ...patch,
});

const group = (...skus: SklejkiSkuMetrics[]): SklejkiGroup => ({ imt_id: 10, shop_label: "Оптима", category_label: "Кремы", skus });

test("margin before DRR includes factual WB rates, tax and warehouse expenses", () => {
  const margin = calculateMarginBeforeDrrPct({
    price: 322.70,
    cost: 34.88,
    warehouseExpenses: 9.57,
    marketplacePct: 50.2,
    acquiringPct: 2.5,
    ratesFactual: true,
  });
  assert.ok(margin != null && Math.abs(margin - 26.55) < 0.05);
});

test("margin before DRR does not accept advertising and supports zero warehouse expenses", () => {
  const input = {
    price: 200,
    cost: 50,
    warehouseExpenses: 0,
    marketplacePct: 20,
    acquiringPct: 2,
    ratesFactual: true,
  };
  assert.equal(calculateMarginBeforeDrrPct(input), 46);
  assert.equal(calculateMarginBeforeDrrPct({ ...input, warehouseExpenses: Number.NaN }), 46);
  assert.equal("advertisingPct" in input, false);
});

test("margin before DRR stays unknown for invalid economics or non-factual rates", () => {
  const valid = {
    price: 200,
    cost: 50,
    warehouseExpenses: 10,
    marketplacePct: 20,
    acquiringPct: 2,
    ratesFactual: true,
  };
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, price: 0 }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, cost: null }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, cost: 0 }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, warehouseExpenses: -10 }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, ratesFactual: false }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, marketplacePct: -1 }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, marketplacePct: Number.POSITIVE_INFINITY }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, acquiringPct: -1 }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, acquiringPct: Number.NaN }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, taxPct: -1 }), null);
  assert.equal(calculateMarginBeforeDrrPct({ ...valid, taxPct: Number.POSITIVE_INFINITY }), null);
});

test("production sklejki margin mapper resolves warehouse and factual WB rate fallbacks", () => {
  const warehouseExpensesByArticle = new Map([["EXACT", 10]]);
  const commission: WbCommission = {
    byNm: new Map([[101, { pct: 20, acqPct: 2, extraPct: 3, rev: 1_000 }]]),
    avgPct: 18,
    avgAcqPct: 1.5,
    avgExtraPct: 2,
    overheadPct: 1,
  };
  const base = { price: 200, cost: 50, warehouseExpensesByArticle, commission };

  const perNm = mapSklejkiMarginBeforeDrr({ ...base, nmId: 101, article: "EXACT" });
  assert.equal(perNm.warehouseExpenses, 10);
  assert.equal(typeof perNm.marginBeforeDrrPct, "number");

  const cabinetFallback = mapSklejkiMarginBeforeDrr({ ...base, nmId: 202, article: "EXACT" });
  assert.equal(typeof cabinetFallback.marginBeforeDrrPct, "number");

  const unknownArticle = mapSklejkiMarginBeforeDrr({ ...base, nmId: 101, article: "UNKNOWN" });
  assert.equal(unknownArticle.warehouseExpenses, 0);
  assert.equal(typeof unknownArticle.marginBeforeDrrPct, "number");

  const missingRates = mapSklejkiMarginBeforeDrr({
    ...base,
    nmId: 303,
    article: "EXACT",
    commission: { byNm: new Map(), avgPct: 0, avgAcqPct: 0, avgExtraPct: 0, overheadPct: 0 },
  });
  assert.equal(missingRates.marginBeforeDrrPct, null);

  for (const result of [perNm, cabinetFallback, unknownArticle, missingRates]) {
    assert.ok(result.marginBeforeDrrPct === null || typeof result.marginBeforeDrrPct === "number");
  }
});

test("interactive sklejki commission loader only uses cached cabinet rates", async () => {
  const emptyCommission: WbCommission = {
    byNm: new Map(),
    avgPct: 0,
    avgAcqPct: 0,
    avgExtraPct: 0,
    overheadPct: 0,
  };
  const calls: unknown[][] = [];
  const commission = await loadSklejkiCommissionForCabinet("cabinet-15", async (...args) => {
    calls.push(args);
    return emptyCommission;
  });

  assert.deepEqual(calls, [["cabinet-15", 30, { allowLiveFallback: false }]]);
  assert.equal(mapSklejkiMarginBeforeDrr({
    nmId: 101,
    article: "SKU-101",
    price: 200,
    cost: 50,
    warehouseExpensesByArticle: new Map(),
    commission,
  }).marginBeforeDrrPct, null);
});

test("Inferno glue verdict keeps the traffic carrier on ads", () => {
  const carrier = sku({ shows_7d: 700, orders_sum_7d: 20_000, adv_spend_14d: 1_000, drr_7d: 5 });
  const other = sku({ nm: 2, shows_7d: 300, orders_sum_7d: 2_000 });
  assert.deepEqual(glueVerdict(group(carrier, other), carrier), {
    tag: "Несущая",
    kind: "green",
    action: "держит показы склейки — рекламу ОСТАВИТЬ · 1 000₽ рекл/14д",
    share: 70,
  });
});

test("Inferno glue verdict separates budget drain, expensive ads and ballast", () => {
  const leader = sku({ shows_7d: 900, orders_sum_7d: 20_000 });
  const drain = sku({ nm: 2, shows_7d: 20, adv_spend_14d: 500, drr_7d: null });
  const expensive = sku({ nm: 3, shows_7d: 80, orders_sum_7d: 2_000, adv_spend_14d: 800, drr_7d: 40 });
  const ballast = sku({ nm: 4, shows_7d: 1 });
  const value = group(leader, drain, expensive, ballast);
  assert.equal(glueVerdict(value, drain).kind, "red");
  assert.equal(glueVerdict(value, expensive).tag, "Дорогая реклама");
  assert.equal(glueVerdict(value, ballast).kind, "gray");
});

test("glue totals calculate DRR from the whole group", () => {
  assert.deepEqual(glueTotals(group(
    sku({ shows_7d: 100, orders_count_7d: 2, orders_sum_7d: 1_000, adv_spend_7d: 100 }),
    sku({ nm: 2, shows_7d: 200, orders_count_7d: 3, orders_sum_7d: 3_000, adv_spend_7d: 300 }),
  )), { shows: 300, orders_count: 5, orders_sum: 4_000, spend: 400, sales: 0, drr: 10 });
});

test("glue totals use sales before order sum as the monetary DRR denominator", () => {
  assert.equal(glueTotals(group(
    sku({ orders_count_7d: 2, orders_sum_7d: 1_000, sales_calc_7d: 500, adv_spend_7d: 100 }),
  )).drr, 20);
});

test("active glue groups are sorted before inactive groups", () => {
  const inactive = { ...group(sku({ nm: 1 })), imt_id: 10 };
  const viewsOnly = { ...group(sku({ nm: 2, shows_7d: 100 })), imt_id: 20 };
  const carrier = { ...group(sku({ nm: 3, shows_7d: 400, orders_sum_7d: 10_000, adv_spend_7d: 1_000 })), imt_id: 30 };

  assert.deepEqual(glueSortedGroups([inactive, viewsOnly, carrier]).map((value) => value.imt_id), [30, 20, 10]);
});

test("sklejki period contains seven closed Moscow days", () => {
  const now = Date.parse("2026-07-14T00:30:00.000Z");
  assert.deepEqual(closedMoscowDates(7, now), ["2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13"]);
  assert.equal(sklejkiPeriod(now), "07.07–13.07");
});

test("sklejki cache schema invalidates snapshots without order counts", async () => {
  const route = await readFile(new URL("../app/api/sklejki/route.ts", import.meta.url), "utf8");
  assert.match(route, /\{ cabinetId, from: .+, to: .+, schema: 5 \}/);
});
