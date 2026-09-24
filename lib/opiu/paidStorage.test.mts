import assert from "node:assert/strict";
import test from "node:test";
import { groupDailyStorageByWeek, paidStoragePrefixFilter } from "./paidStorage.ts";

test("платное хранение фильтруется по бренду до скачивания строк", () => {
  assert.equal(paidStoragePrefixFilter(["NV-", "HT-"]), "vendor_code.like.NV-%,vendor_code.like.HT-%");
  assert.equal(paidStoragePrefixFilter(undefined), null);
});

test("служебные символы PostgREST не попадают в префиксный фильтр", () => {
  assert.equal(paidStoragePrefixFilter(["N%,V-"]), "vendor_code.like.NV-%");
});

test("суточные итоги хранения без потерь складываются в недели ОПиУ", () => {
  const result = groupDailyStorageByWeek([
    { date: "2026-08-01", warehouse_price: 100.25 },
    { date: "2026-08-02", warehouse_price: -20.25 },
    { date: "2026-08-03", warehouse_price: 40 },
  ], [
    { weekStart: "2026-07-27", rangeFrom: "2026-08-01", rangeTo: "2026-08-02", label: "1–2 авг." },
    { weekStart: "2026-08-03", rangeFrom: "2026-08-03", rangeTo: "2026-08-09", label: "3–9 авг." },
  ]);

  assert.deepEqual(result, { "2026-07-27": 80, "2026-08-03": 40 });
});
