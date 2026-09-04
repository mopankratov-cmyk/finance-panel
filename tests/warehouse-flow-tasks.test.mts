import { strict as assert } from "node:assert";
import test from "node:test";
import {
  TASK_STATUS_LABEL,
  overReserved,
  reservationKey,
  reservedByVariant,
  type ShipmentTaskStatus,
} from "../lib/warehouse/tasks.ts";

test("резерв считается по паре «склад:размер» и суммируется по черновикам", () => {
  const map = reservedByVariant([
    { warehouseId: "ff", variantId: "v1", qty: 3 },
    { warehouseId: "ff", variantId: "v1", qty: 2 },
    { warehouseId: "transit", variantId: "v1", qty: 7 },
    { warehouseId: "ff", variantId: "v2", qty: 1 },
  ]);
  assert.equal(map.get(reservationKey("ff", "v1")), 5);
  assert.equal(map.get(reservationKey("transit", "v1")), 7);
  assert.equal(map.get(reservationKey("ff", "v2")), 1);
  assert.equal(map.get("ff:v1"), 5, "ключ — склад и размер через двоеточие");
  assert.equal(map.size, 3);
});

test("строки без склада в резерв не попадают", () => {
  const map = reservedByVariant([
    { warehouseId: null, variantId: "v1", qty: 3 },
    { warehouseId: "ff", variantId: "v1", qty: 2 },
  ]);
  assert.equal(map.get("ff:v1"), 2);
  assert.equal(map.size, 1);
});

test("отрицательное и нечисловое количество не уменьшает резерв", () => {
  const map = reservedByVariant([
    { warehouseId: "ff", variantId: "v1", qty: 4 },
    { warehouseId: "ff", variantId: "v1", qty: -3 },
    { warehouseId: "ff", variantId: "v1", qty: Number.NaN },
  ]);
  assert.equal(map.get("ff:v1"), 4);
});

test("нехватка ищется по сумме строк одного размера против доступного", () => {
  const available = new Map([["v1", 5], ["v2", 1]]);
  assert.deepEqual(overReserved([{ variantId: "v1", qty: 5 }, { variantId: "v2", qty: 1 }], available), []);
  // Две строки по 3 на один размер — это 6, а доступно 5.
  assert.deepEqual(overReserved([{ variantId: "v1", qty: 3 }, { variantId: "v1", qty: 3 }], available), [
    { variantId: "v1", qty: 6 },
  ]);
});

test("размер, которого нет в доступном, считается нулём", () => {
  assert.deepEqual(overReserved([{ variantId: "v9", qty: 1 }], new Map()), [{ variantId: "v9", qty: 1 }]);
  assert.deepEqual(overReserved([{ variantId: "v9", qty: 0 }], new Map()), []);
});

test("подпись есть у каждого статуса задания", () => {
  const statuses: ShipmentTaskStatus[] = ["draft", "posted", "cancelled", "reversed"];
  for (const status of statuses) {
    assert.ok(TASK_STATUS_LABEL[status]?.trim(), `нет подписи для ${status}`);
  }
  assert.equal(Object.keys(TASK_STATUS_LABEL).length, statuses.length);
  assert.equal(TASK_STATUS_LABEL.draft, "ждёт ФФ");
});
