import test from "node:test";
import assert from "node:assert/strict";
import { allocateWholeContainers, restrictTaraLines } from "../lib/supplies/wms";
import { mapTaraToAssortment, type MoySkladAssortment } from "../lib/moysklad/api";
import type { TaraLine } from "../lib/supplies/tara";

const line = (container: string, nmId: number | null, article: string, quantity: number): TaraLine => ({ lineNumber: 2, container, nmId, article, barcode: "", quantity, volumeLiters: null });
const assortment = (id: string, article: string): MoySkladAssortment => ({ id, name: article, code: article, article, externalCode: "", barcodes: [], meta: { href: `https://api.moysklad.ru/api/remap/1.2/entity/product/${id}`, type: "product", mediaType: "application/json" } });

test("Optima scope drops unresolved and foreign tara before any external mapping", () => {
  const result = restrictTaraLines([line("A", 101, "NORVIA", 2), line("B", 999, "OTHER", 3), line("C", null, "UNKNOWN", 1)], new Set([101]));
  assert.deepEqual(result.lines.map((row) => row.nmId), [101]);
  assert.equal(result.blocked, 1);
  assert.equal(result.unresolved, 1);
});

test("MoySklad assortment mapping prefers exact barcode and article matches", () => {
  const catalog = [assortment("1", "NORVIA-1"), { ...assortment("2", "RIOBOX-2"), barcodes: ["0460000000002"] }];
  const rows = [line("A", 1, "NORVIA-1", 2), { ...line("B", 2, "wrong", 3), barcode: "0460000000002" }];
  const result = mapTaraToAssortment(rows, catalog);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.mapped.map((row) => row.assortment.id), ["1", "2"]);
});

test("whole boxes are never split between destination warehouses", () => {
  const catalog = [assortment("1", "SKU")];
  const mapped = [line("BOX-1", 1, "SKU", 60), line("BOX-2", 1, "SKU", 40), line("BOX-3", 1, "SKU", 20)].map((row) => ({ line: row, assortment: catalog[0] }));
  const plan = allocateWholeContainers(mapped, [{ name: "Коледино", pct: 50 }, { name: "Казань", pct: 50 }], new Set(), ["a", "b"]);
  const allBoxes = plan.orders.flatMap((order) => order.containers);
  assert.deepEqual([...allBoxes].sort(), ["BOX-1", "BOX-2", "BOX-3"]);
  assert.equal(new Set(allBoxes).size, 3);
  assert.equal(plan.orders.reduce((sum, order) => sum + order.totalQuantity, 0), 120);
});

test("a box containing an excluded SKU is excluded as a whole", () => {
  const catalog = [assortment("1", "SKU-1"), assortment("2", "SKU-2")];
  const mapped = [line("MIXED", 1, "SKU-1", 3), line("MIXED", 2, "SKU-2", 2)].map((row, index) => ({ line: row, assortment: catalog[index] }));
  const plan = allocateWholeContainers(mapped, [{ name: "Коледино", pct: 100 }], new Set([2]), ["a"]);
  assert.deepEqual(plan.excludedContainers, ["MIXED"]);
  assert.equal(plan.orders.length, 0);
});
