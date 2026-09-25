import assert from "node:assert/strict";
import test from "node:test";
import {
  addPaidStorageCoverageRows,
  compactPaidStorageRows,
  filterPaidStorageRowsByPrefixes,
  isMissingPaidStorageTask,
  normalizePaidStorageTaskStatus,
} from "./paidStorageRequest.ts";

test("удалённая задача платного хранения распознаётся по ответу WB 404", () => {
  assert.equal(isMissingPaidStorageTask(404, '{"detail":"not found"}'), true);
  assert.equal(isMissingPaidStorageTask(404, "Task Not-Found"), true);
});

test("другие ошибки WB не сбрасывают taskId как протухший", () => {
  assert.equal(isMissingPaidStorageTask(429, "too many requests"), false);
  assert.equal(isMissingPaidStorageTask(500, "not found"), false);
  assert.equal(isMissingPaidStorageTask(404, "forbidden"), false);
});

test("новая задача WB считается ожидающей обработки, а не ошибкой", () => {
  assert.equal(normalizePaidStorageTaskStatus("new"), "processing");
  assert.equal(normalizePaidStorageTaskStatus("processing"), "processing");
  assert.equal(normalizePaidStorageTaskStatus("unexpected"), "unknown");
});

test("compactPaidStorageRows sums detailed WB charges without changing the total", () => {
  const rows = compactPaidStorageRows("cabinet-1", [
    { date: "2026-08-10", nmId: 101, vendorCode: "NV-01", officeId: 1, warehousePrice: 12.25 },
    { date: "2026-08-10", nmId: 101, vendorCode: "nv-01", officeId: 2, warehousePrice: 7.75 },
    { date: "2026-08-10", nmId: 202, vendorCode: "HT-02", officeId: 1, warehousePrice: -1.5 },
    { date: "2026-08-11T00:00:00Z", nmId: 101, vendorCode: "NV-01", officeId: 1, warehousePrice: 3 },
  ], "2026-09-24T10:00:00.000Z");

  assert.equal(rows.length, 3);
  assert.equal(rows.reduce((sum, row) => sum + row.warehouse_price, 0), 21.5);
  assert.deepEqual(rows[0], {
    id: "cabinet-1|daily|2026-08-10|101|NV-01",
    cabinet_id: "cabinet-1",
    date: "2026-08-10",
    nm_id: 101,
    vendor_code: "NV-01",
    warehouse_price: 20,
    synced_at: "2026-09-24T10:00:00.000Z",
  });
});

test("compactPaidStorageRows keeps a zero coverage row and skips invalid dates", () => {
  const rows = compactPaidStorageRows("cabinet-1", [
    { date: "", warehousePrice: 100 },
    { date: "2026-08-12", warehousePrice: 0 },
  ], "2026-09-24T10:00:00.000Z");

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.date, "2026-08-12");
  assert.equal(rows[0]?.nm_id, null);
  assert.equal(rows[0]?.vendor_code, null);
  assert.equal(rows[0]?.warehouse_price, 0);
});

test("filterPaidStorageRowsByPrefixes keeps only OPIU brands in an agent cabinet", () => {
  const rows = filterPaidStorageRowsByPrefixes([
    { date: "2026-08-12", vendorCode: "ESC001", warehousePrice: 10 },
    { date: "2026-08-12", vendorCode: "nv-01", warehousePrice: 20 },
    { date: "2026-08-12", vendorCode: "HT-80", warehousePrice: 30 },
    { date: "2026-08-12", vendorCode: "FOREIGN", warehousePrice: 40 },
  ], ["ESC", "NV-", "HT-"]);

  assert.deepEqual(rows.map((row) => row.vendorCode), ["ESC001", "nv-01", "HT-80"]);
  assert.equal(filterPaidStorageRowsByPrefixes(rows, null).length, 3);
});

test("addPaidStorageCoverageRows preserves an explicit zero for empty synced days", () => {
  const rows = addPaidStorageCoverageRows([
    { date: "2026-08-11", vendorCode: "ESC001", warehousePrice: 10 },
  ], "2026-08-10", "2026-08-12");

  assert.deepEqual(rows.map((row) => [row.date, row.warehousePrice]), [
    ["2026-08-11", 10],
    ["2026-08-10", 0],
    ["2026-08-12", 0],
  ]);
});
