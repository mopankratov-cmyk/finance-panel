import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MARKETPLACE_METRICS, marketplaceMetricStatus } from "../lib/analytics/marketplaceMetrics";
import { buildWbFunnelDayMetrics, percentRatio } from "../lib/wb/funnelMetrics";

test("percentRatio считает CR просмотра карточки в корзину", () => {
  assert.equal(percentRatio(25, 200), 12.5);
  assert.notEqual(percentRatio(25, 200), percentRatio(25, 50));
  assert.equal(percentRatio(0, 0), null);
  assert.equal(percentRatio(Number.POSITIVE_INFINITY, 200), null);
  assert.equal(percentRatio(25, Number.NaN), null);
});

test("дневной агрегатор сначала суммирует кабинеты и затем считает rates", () => {
  const metrics = buildWbFunnelDayMetrics(
    [
      { nm_id: 123, date: "2026-07-17", open_card: 100, add_to_cart: 10, orders: 2, orders_sum: 200 },
      { nm_id: 123, date: "2026-07-17T03:00:00Z", open_card: 300, add_to_cart: 60, orders: 12, orders_sum: 800 },
    ],
    [
      { nm_id: 123, date: "2026-07-17", views: 1_000, clicks: 50, spent: 20 },
      { nm_id: 123, date: "2026-07-17T03:00:00Z", views: 1_000, clicks: 150, spent: 30 },
    ],
  );

  assert.deepEqual(metrics[123]["2026-07-17"], {
    views: 2_000,
    clicks: 200,
    advert_sum: 50,
    ctr: 10,
    open_card: 400,
    carts: 70,
    orders_count: 14,
    orders_sum: 1_000,
    cart_cr: 17.5,
    cr: 20,
    drr: 5,
  });
});

test("канон метрик содержит CR просмотр→корзина и conversion-пороги", () => {
  assert.equal(MARKETPLACE_METRICS.cardToCartCr.label, "CR просмотр→корзина");
  assert.match(MARKETPLACE_METRICS.cardToCartCr.definition, /Рекламные показы и клики в знаменатель не входят/);
  assert.equal(marketplaceMetricStatus("cardToCartCr", 0), "unknown");
  assert.equal(marketplaceMetricStatus("cardToCartCr", 2.99), "warning");
  assert.equal(marketplaceMetricStatus("cardToCartCr", 5), "neutral");
  assert.equal(marketplaceMetricStatus("cardToCartCr", 10), "good");
});

test("routes и UI подключают production helper и новый контракт", async () => {
  const [skuRoute, dayRoute, ui] = await Promise.all([
    readFile(new URL("../app/api/seo/skus/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/design/day-metrics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/wb/WbFunnelPage.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(skuRoute, /cv_cart_7d:\s*percentRatio\(w\.cart, w\.open\)/);
  assert.match(skuRoute, /schema:\s*4/);
  assert.match(dayRoute, /buildWbFunnelDayMetrics\(scopedFunnelRows, scopedAdRows\)/);
  assert.match(dayRoute, /schema:\s*4/);
  assert.match(ui, /cv_cart_window:\s*number\s*\|\s*null/);
  assert.match(ui, /MetricKey[^;]+"cart_cr"/);
  assert.match(ui, /metricId:\s*"cardToCartCr"/);
  assert.match(ui, />% в корзину</);
  assert.match(ui, /pct\(sku\.cv_cart_window\)/);
});
