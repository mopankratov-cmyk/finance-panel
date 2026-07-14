import assert from "node:assert/strict";
import test from "node:test";
import { closedMoscowDates, glueSortedGroups, glueTotals, glueVerdict, sklejkiPeriod, type SklejkiGroup, type SklejkiSkuMetrics } from "../lib/wb/sklejki";

const sku = (patch: Partial<SklejkiSkuMetrics>): SklejkiSkuMetrics => ({
  nm: 1,
  art: "SKU-1",
  name: "Товар",
  img_url: "",
  shop: "Оптима",
  shows_7d: 0,
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
    sku({ shows_7d: 100, orders_sum_7d: 1_000, adv_spend_7d: 100 }),
    sku({ nm: 2, shows_7d: 200, orders_sum_7d: 3_000, adv_spend_7d: 300 }),
  )), { shows: 300, orders: 4_000, spend: 400, sales: 0, drr: 10 });
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
