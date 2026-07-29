import assert from "node:assert/strict";
import test from "node:test";

import { buildRnpFocusSummary, type RnpFocusSku } from "./focusSummary";

function sku(input: {
  nm: number;
  art: string;
  ordersRub?: number | null;
  ordersCount?: number | null;
  buyoutsRub?: number | null;
  buyoutsCount?: number | null;
  adSpent?: number | null;
  gross?: number | null;
  marginPct?: number | null;
  stock?: number | null;
  turnover?: number | null;
  money?: number | null;
  gmroi?: number | null;
  missingCost?: boolean;
}): RnpFocusSku {
  return {
    nm: input.nm,
    art: input.art,
    name: input.art,
    metrics: [
      { field: "orders_sum", total: input.ordersRub ?? null, status: "ready" },
      { field: "orders_count", total: input.ordersCount ?? null, status: "ready" },
      { field: "buyouts_sum", total: input.buyoutsRub ?? null, status: "ready" },
      { field: "buyouts_count", total: input.buyoutsCount ?? null, status: "ready" },
      { field: "ad_spent", total: input.adSpent ?? null, status: "ready" },
      { field: "gross", total: input.gross ?? null, status: input.missingCost ? "unavailable" : "ready", qualityReason: input.missingCost ? "missing_cost" : undefined },
      { field: "margin_pct", total: input.marginPct ?? null, status: input.missingCost ? "unavailable" : "ready", qualityReason: input.missingCost ? "missing_cost" : undefined },
      { field: "stock", total: input.stock ?? null, status: "ready" },
      { field: "turnover", total: input.turnover ?? null, status: "ready" },
      { field: "money", total: input.money ?? null, status: input.missingCost ? "unavailable" : "ready", qualityReason: input.missingCost ? "missing_cost" : undefined },
      { field: "gmroi", total: input.gmroi ?? null, status: input.missingCost ? "unavailable" : "ready", qualityReason: input.missingCost ? "missing_cost" : undefined },
    ],
  };
}

test("RNP focus summary aggregates only the provided SKU slice", () => {
  const summary = buildRnpFocusSummary([
    sku({ nm: 1, art: "NV-01", ordersRub: 100_000, ordersCount: 10, buyoutsRub: 50_000, buyoutsCount: 5, adSpent: 10_000, gross: 20_000, stock: 7, turnover: 7, money: 40_000 }),
    sku({ nm: 2, art: "NV-02", ordersRub: 50_000, ordersCount: 5, buyoutsRub: 20_000, buyoutsCount: 2, adSpent: 5_000, gross: 5_000, stock: 100, turnover: 60, money: 10_000 }),
  ]);

  assert.equal(summary.skuCount, 2);
  assert.equal(summary.ordersRub, 150_000);
  assert.equal(summary.ordersCount, 15);
  assert.equal(summary.buyoutsRub, 70_000);
  assert.equal(summary.buyoutPct, 46.7);
  assert.equal(summary.drr, 10);
  assert.equal(summary.gmroi, 50);
});

test("RNP focus summary highlights management risks", () => {
  const summary = buildRnpFocusSummary([
    sku({ nm: 1, art: "RISK-STOCK", ordersRub: 100_000, ordersCount: 10, buyoutsRub: 10_000, buyoutsCount: 1, adSpent: 40_000, gross: -10_000, marginPct: -100, stock: 3, turnover: 3, money: 10_000 }),
    sku({ nm: 2, art: "RISK-ADS", ordersRub: 0, ordersCount: 0, buyoutsRub: 0, buyoutsCount: 0, adSpent: 7_000, gross: 0, stock: 50, turnover: null, money: 10_000 }),
    sku({ nm: 3, art: "RISK-DATA", ordersRub: 10_000, ordersCount: 1, missingCost: true, stock: 5, turnover: 5 }),
  ]);

  const signals = new Map(summary.signals.map((signal) => [signal.id, signal]));

  assert.equal(signals.get("stock_risk")?.count, 2);
  assert.match(signals.get("stock_risk")?.detail ?? "", /RISK-STOCK/);
  assert.equal(signals.get("high_drr")?.count, 1);
  assert.equal(signals.get("negative_margin")?.count, 1);
  assert.equal(signals.get("ads_without_orders")?.count, 1);
  assert.equal(signals.get("data_gaps")?.count, 1);
});
