import assert from "node:assert/strict";
import test from "node:test";

import { buildAdTypeMetrics, type AdTypeDayBucket } from "../lib/rnp/buildTable";
import { wbBidTypeGroup } from "../lib/wb/advertTypes";
import { RNP_METRIC_FIELDS } from "../lib/rnp/operatingMatrix";

// Сплит рекламы по видам кампаний. Значения bid_type сняты зондом с живой базы:
// manual, unified и буквальный «unknown» от WB.

test("маппинг типов соответствует живым значениям WB", () => {
  assert.equal(wbBidTypeGroup("manual"), "manual");
  assert.equal(wbBidTypeGroup("unified"), "unified");
  // Буквальный «unknown» от WB и пустота не приписываются ни к одной группе.
  assert.equal(wbBidTypeGroup("unknown"), null);
  assert.equal(wbBidTypeGroup(null), null);
  assert.equal(wbBidTypeGroup(""), null);
});

const days = ["2026-08-15", "2026-08-16"];
const bucket = (spent: number, orders: number): AdTypeDayBucket => ({ spent, views: spent * 10, clicks: spent, orders, ordersSum: orders * 100 });

test("метрики считаются по группам и дням", () => {
  const buckets = new Map([
    ["manual", new Map([["2026-08-15", bucket(1000, 5)]])],
    ["unified", new Map([["2026-08-16", bucket(500, 2)]])],
  ]);
  const metrics = buildAdTypeMetrics(days, "2026-08-16", buckets, 0, "2026-08-16");
  const manualSpent = metrics.find((metric) => metric.field === "ads_manual_spent");
  const unifiedOrders = metrics.find((metric) => metric.field === "ads_unified_orders");
  // День в пределах cutoff без кампаний группы — честный ноль, а не пусто.
  assert.deepEqual(manualSpent?.daily, [1000, 0]);
  assert.equal(manualSpent?.total, 1000);
  assert.deepEqual(unifiedOrders?.daily, [0, 2]);
});

test("дни после cutoff рекламы остаются пустыми", () => {
  const metrics = buildAdTypeMetrics(days, "2026-08-16", new Map(), 0, "2026-08-15");
  const spent = metrics.find((metric) => metric.field === "ads_manual_spent");
  assert.deepEqual(spent?.daily, [0, null]);
});

test("расход неопознанных кампаний виден в note, а не растворён", () => {
  const metrics = buildAdTypeMetrics(days, "2026-08-16", new Map(), 12_345, "2026-08-16");
  assert.match(String(metrics[0]?.note), /неопознанным типом/);
  assert.match(String(metrics[0]?.note), /12 345|12 345/);
});

test("поля зарегистрированы в каталоге", () => {
  for (const group of ["manual", "unified"]) {
    for (const metric of ["spent", "views", "clicks", "orders", "orders_sum"]) {
      assert.ok((RNP_METRIC_FIELDS as readonly string[]).includes(`ads_${group}_${metric}`), `нет ads_${group}_${metric}`);
    }
  }
});
