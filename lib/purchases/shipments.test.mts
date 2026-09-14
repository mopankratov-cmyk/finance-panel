import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShipmentPayload } from "./shipments.ts";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";

test("requires a valid orderId", () => {
  const missing = normalizeShipmentPayload({ status: "planned" });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /заказ/i);

  const malformed = normalizeShipmentPayload({ orderId: "not-a-uuid", status: "planned" });
  assert.equal(malformed.ok, false);
});

test("collects a planned shipment with no items yet", () => {
  const result = normalizeShipmentPayload({ orderId: ORDER_ID, status: "planned", carrier: "ТрансКит" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.orderId, ORDER_ID);
  assert.equal(result.value.status, "planned");
  assert.equal(result.value.carrier, "ТрансКит");
  assert.deepEqual(result.value.items, []);
});

test("rejects an unknown status", () => {
  const result = normalizeShipmentPayload({ orderId: ORDER_ID, status: "in_orbit" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /статус/i);
});

test("shipped/customs/arrived/received require at least one item", () => {
  for (const status of ["shipped", "customs", "arrived", "received"]) {
    const result = normalizeShipmentPayload({ orderId: ORDER_ID, status, items: [] });
    assert.equal(result.ok, false, `${status} should require items`);
  }
  const cancelled = normalizeShipmentPayload({ orderId: ORDER_ID, status: "cancelled", items: [] });
  assert.equal(cancelled.ok, true);
});

test("rejects duplicate or invalid item rows", () => {
  const duplicate = normalizeShipmentPayload({
    orderId: ORDER_ID, status: "shipped",
    items: [{ nmId: 1, quantity: 5 }, { nmId: 1, quantity: 3 }],
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.match(duplicate.error, /уже добавлен/);

  const badQuantity = normalizeShipmentPayload({ orderId: ORDER_ID, status: "shipped", items: [{ nmId: 1, quantity: 0 }] });
  assert.equal(badQuantity.ok, false);
});

test("id is passed through only via the forced parameter", () => {
  const withForced = normalizeShipmentPayload({ orderId: ORDER_ID, status: "planned" }, { id: "forced-id", orderId: ORDER_ID });
  assert.equal(withForced.ok, true);
  if (withForced.ok) assert.equal(withForced.value.id, "forced-id");
});

test("eta must be a real ISO date, timestamps default to null when missing", () => {
  const result = normalizeShipmentPayload({ orderId: ORDER_ID, status: "planned", eta: "not-a-date", shippedAt: "" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.eta, null);
  assert.equal(result.value.shippedAt, null);

  const withEta = normalizeShipmentPayload({ orderId: ORDER_ID, status: "planned", eta: "2026-10-01" });
  assert.equal(withEta.ok, true);
  if (withEta.ok) assert.equal(withEta.value.eta, "2026-10-01");
});
