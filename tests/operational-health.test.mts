import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationalOrder, freshnessState, healthScore, type RawOperationalOrder } from "../lib/health/operations";

const baseOrder = (patch: Partial<RawOperationalOrder> = {}): RawOperationalOrder => ({
  id: "order-1",
  orderNumber: "Z-101",
  supplier: "Фабрика",
  status: "production",
  orderDate: "2026-06-01",
  expectedReadyDate: "2026-06-20",
  receiptBatchId: null,
  items: [{ nmId: 1244157227, quantity: 100 }],
  logisticsStages: [],
  ...patch,
});

test("operational timeline names an overdue production deadline", () => {
  const order = buildOperationalOrder(baseOrder(), [], new Date("2026-07-13T10:00:00.000Z"));
  assert.equal(order.state, "overdue");
  assert.equal(order.stages[0]?.state, "overdue");
  assert.match(order.alerts[0]?.title ?? "", /производство просрочено/i);
  assert.equal(order.quantity, 100);
});

test("completed logistics and receipt close the operational cycle", () => {
  const order = buildOperationalOrder(baseOrder({
    status: "received",
    receiptBatchId: "batch-1",
    logisticsStages: [{ title: "Доставка", provider: "Карго", dueDate: "2026-06-28", completedAt: "2026-06-27T12:00:00Z", status: "done" }],
  }), [{ batchId: "batch-1", expectedAt: "2026-07-01", receivedAt: "2026-06-30T09:00:00Z", status: "received" }], new Date("2026-07-13T10:00:00.000Z"));
  assert.equal(order.state, "complete");
  assert.equal(order.progressPct, 100);
  assert.deepEqual(order.stages.map((stage) => stage.state), ["done", "done", "done"]);
  assert.equal(order.alerts.length, 0);
});

test("cabinet service freshness has explicit warning and error thresholds", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  assert.equal(freshnessState("2026-07-13T06:00:00.000Z", now), "ok");
  assert.equal(freshnessState("2026-07-12T05:00:00.000Z", now), "warning");
  assert.equal(freshnessState("2026-07-09T05:00:00.000Z", now), "error");
  assert.equal(freshnessState(null, now), "warning");
});

test("health score gives warnings half weight", () => {
  assert.equal(healthScore([
    { key: "wb", name: "WB", state: "ok", detail: "ok", updatedAt: null },
    { key: "wms", name: "WMS", state: "warning", detail: "setup", updatedAt: null },
    { key: "sync", name: "Sync", state: "error", detail: "failed", updatedAt: null },
  ]), 50);
});
