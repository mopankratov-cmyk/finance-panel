import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDiscrepancyActPayload } from "./discrepancyActs.ts";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const BATCH_ID = "22222222-2222-2222-2222-222222222222";

test("requires a valid purchaseOrderId and batchId", () => {
  const missingOrder = normalizeDiscrepancyActPayload({ batchId: BATCH_ID, resolution: "wait_restock" });
  assert.equal(missingOrder.ok, false);
  if (!missingOrder.ok) assert.match(missingOrder.error, /заказ/i);

  const missingBatch = normalizeDiscrepancyActPayload({ purchaseOrderId: ORDER_ID, resolution: "wait_restock" });
  assert.equal(missingBatch.ok, false);
  if (!missingBatch.ok) assert.match(missingBatch.error, /парти/i);
});

test("requires a known resolution", () => {
  const missing = normalizeDiscrepancyActPayload({ purchaseOrderId: ORDER_ID, batchId: BATCH_ID });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /решение/i);

  const unknown = normalizeDiscrepancyActPayload({ purchaseOrderId: ORDER_ID, batchId: BATCH_ID, resolution: "shrug" });
  assert.equal(unknown.ok, false);
});

test("collects a valid act and defaults status to open", () => {
  const result = normalizeDiscrepancyActPayload({ purchaseOrderId: ORDER_ID, batchId: BATCH_ID, resolution: "claim", note: "ждём ответ фабрики" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.purchaseOrderId, ORDER_ID);
  assert.equal(result.value.batchId, BATCH_ID);
  assert.equal(result.value.resolution, "claim");
  assert.equal(result.value.status, "open");
  assert.equal(result.value.note, "ждём ответ фабрики");
});

test("accepts an explicit resolved status", () => {
  const result = normalizeDiscrepancyActPayload({ purchaseOrderId: ORDER_ID, batchId: BATCH_ID, resolution: "refund", status: "resolved" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.status, "resolved");
});

test("id is passed through only via the forced parameter", () => {
  const withForced = normalizeDiscrepancyActPayload(
    { resolution: "accept_replacement" },
    { id: "forced-id", purchaseOrderId: ORDER_ID, batchId: BATCH_ID },
  );
  assert.equal(withForced.ok, true);
  if (withForced.ok) assert.equal(withForced.value.id, "forced-id");
});
