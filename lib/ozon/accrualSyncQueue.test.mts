import assert from "node:assert/strict";
import test from "node:test";
import { selectOzonAccrualQueueCabinet, type OzonAccrualQueueState } from "./accrualSyncQueue.ts";

test("a cabinet with no state at all (never synced) wins over one synced recently", () => {
  const states: OzonAccrualQueueState[] = [
    { cabinetId: "a", status: "ok", updatedAt: new Date().toISOString() },
  ];
  const picked = selectOzonAccrualQueueCabinet(["a", "b"], states);
  assert.equal(picked, "b");
});

test("the cabinet with the oldest updatedAt wins", () => {
  const states: OzonAccrualQueueState[] = [
    { cabinetId: "a", status: "ok", updatedAt: "2026-09-24T10:00:00.000Z" },
    { cabinetId: "b", status: "ok", updatedAt: "2026-09-20T10:00:00.000Z" },
  ];
  const picked = selectOzonAccrualQueueCabinet(["a", "b"], states);
  assert.equal(picked, "b");
});

test("ties break by input order", () => {
  const states: OzonAccrualQueueState[] = [
    { cabinetId: "a", status: "ok", updatedAt: "2026-09-24T10:00:00.000Z" },
    { cabinetId: "b", status: "ok", updatedAt: "2026-09-24T10:00:00.000Z" },
  ];
  const picked = selectOzonAccrualQueueCabinet(["a", "b"], states);
  assert.equal(picked, "a");
});

test("an empty cabinet list returns null instead of throwing", () => {
  assert.equal(selectOzonAccrualQueueCabinet([], []), null);
});

test("duplicate cabinet ids in the input are de-duplicated", () => {
  const picked = selectOzonAccrualQueueCabinet(["a", "a", "b"], []);
  assert.equal(picked, "a");
});
