import assert from "node:assert/strict";
import test from "node:test";

import { appendTaxMetrics } from "./taxMetrics.ts";
import type { Metric } from "./buildTable.ts";

const metric = (field: string, kind: string, daily: (number | null)[], total: number | null, extra: Partial<Metric> = {}): Metric =>
  ({ field, kind, daily, total, forecast: null, label: field, ...extra }) as Metric;

test("net_margin_pct строки сводки делится на выкупы только SKU с известной себестоимостью", () => {
  // Половина оборота — SKU без себестоимости: gross (после фикса profit_per_unit/
  // romi) уже урезан до costedSkus, а margin_pct несёт weeklyParts с тем же
  // знаменателем (10 000 ₽, не 20 000 ₽ по всем SKU). net_margin_pct обязан
  // делить на тот же знаменатель, иначе воспроизводит уже раз найденный баг.
  const metrics: Metric[] = [
    metric("gross", "money", [1_000], 1_000),
    metric("buyouts_sum", "money", [20_000], 20_000),
    metric("margin_pct", "pct", [10], 10, {
      weeklyParts: { numerator: [1_000], denominator: [10_000], scale: 100 },
    }),
  ];
  const result = appendTaxMetrics(metrics, 0, {});
  const netMargin = result.find((item) => item.field === "net_margin_pct")!;
  // net_profit = gross (налог 0%, комиссии кабинета нет) = 1000.
  assert.equal(netMargin.daily[0], 10, "1000 / 10000 из margin_pct.weeklyParts, а не 1000 / 20000 из buyouts_sum");
  assert.equal(netMargin.total, 10);
});

test("net_margin_pct СТРОКИ ОДНОГО SKU (без margin_pct.weeklyParts) считается по своему buyouts_sum как раньше", () => {
  const metrics: Metric[] = [
    metric("gross", "money", [1_000], 1_000),
    metric("buyouts_sum", "money", [10_000], 10_000),
    metric("margin_pct", "pct", [10], 10),
  ];
  const result = appendTaxMetrics(metrics, 0, {});
  const netMargin = result.find((item) => item.field === "net_margin_pct")!;
  assert.equal(netMargin.total, 10, "у одного SKU costed-разрыва нет — buyouts_sum и так верный знаменатель");
  assert.equal((netMargin as { weeklyParts?: unknown }).weeklyParts, undefined, "weeklyParts только когда есть у margin_pct");
});

test("net_margin_pct несёт weeklyParts дальше, когда у margin_pct он есть — для недельной колонки", () => {
  const metrics: Metric[] = [
    metric("gross", "money", [1_000], 1_000),
    metric("buyouts_sum", "money", [20_000], 20_000),
    metric("margin_pct", "pct", [10], 10, {
      weeklyParts: { numerator: [1_000], denominator: [10_000], scale: 100 },
    }),
  ];
  const result = appendTaxMetrics(metrics, 0, {});
  const netMargin = result.find((item) => item.field === "net_margin_pct")! as Metric & { weeklyParts?: { numerator: unknown[]; denominator: unknown[]; scale: number } };
  assert.ok(netMargin.weeklyParts, "weeklyParts должен быть виден aggregateRnpWeekly");
  assert.deepEqual(netMargin.weeklyParts!.denominator, [10_000]);
});
