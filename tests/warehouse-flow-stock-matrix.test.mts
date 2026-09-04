import { strict as assert } from "node:assert";
import test from "node:test";
import {
  buildStockMatrix,
  compareSizeLabels,
  receiptCell,
  shipmentCell,
  type StockVariantRow,
} from "../lib/warehouse/stockMatrix.ts";

const FF = "wh-ff", TRANSIT = "wh-transit";

const row = (over: Partial<StockVariantRow>): StockVariantRow => ({
  variantId: "v",
  productId: "p",
  article: "NV-836-02",
  name: "Ветровка",
  sizeLabel: "42",
  barcode: null,
  nmId: null,
  photoUrl: null,
  imtId: null,
  model: null,
  color: null,
  isNovelty: false,
  qty: 0,
  amount: 0,
  unitCost: 0,
  byWarehouse: [],
  reserved: 0,
  expected: 0,
  received: 0,
  shipped: 0,
  receipts: [],
  shipments: [],
  ...over,
});

test("два товара одного imtID — одна модель с двумя цветами", () => {
  const models = buildStockMatrix([
    row({ variantId: "v1", productId: "p1", article: "NV-836-02", imtId: 777, qty: 3 }),
    row({ variantId: "v2", productId: "p2", article: "NV-836-04", imtId: 777, qty: 4 }),
  ]);
  assert.equal(models.length, 1);
  assert.equal(models[0].key, "imt:777");
  assert.deepEqual(models[0].colors.map((color) => color.article), ["NV-836-02", "NV-836-04"]);
  assert.deepEqual(models[0].colors.map((color) => color.color), ["02", "04"]);
});

test("товары без карточки WB группируются по модели из артикула", () => {
  const models = buildStockMatrix([
    row({ variantId: "v1", productId: "p1", article: "NV-836-02", qty: 1 }),
    row({ variantId: "v2", productId: "p2", article: "NV-836-04", qty: 1 }),
    row({ variantId: "v3", productId: "p3", article: "HT-83-17", qty: 1 }),
  ]);
  assert.deepEqual(models.map((model) => model.label), ["HT-83", "NV-836"]);
  assert.equal(models[1].colors.length, 2);
});

test("размеры идут по числу в ярлыке, буквенные — после числовых", () => {
  assert.ok(compareSizeLabels("40", "42-44") < 0);
  assert.ok(compareSizeLabels("42-44", "46") < 0);
  assert.ok(compareSizeLabels("46", "40") > 0);
  assert.ok(compareSizeLabels("XL", "40") > 0, "буквенный размер после числового");
  assert.ok(compareSizeLabels("40", "XL") < 0);
  assert.ok(compareSizeLabels("M", "S") < 0, "буквенные — по алфавиту");
  assert.equal(compareSizeLabels("42", "42"), 0);

  const models = buildStockMatrix([
    row({ variantId: "v1", sizeLabel: "46", qty: 1 }),
    row({ variantId: "v2", sizeLabel: "XL", qty: 1 }),
    row({ variantId: "v3", sizeLabel: "42-44", qty: 1 }),
    row({ variantId: "v4", sizeLabel: "40", qty: 1 }),
  ]);
  assert.deepEqual(models[0].colors[0].sizes.map((size) => size.sizeLabel), ["40", "42-44", "46", "XL"]);
});

test("итоги модели — сумма по цветам, итоги цвета — сумма по размерам", () => {
  const models = buildStockMatrix([
    row({
      variantId: "v1", productId: "p1", article: "NV-836-02", imtId: 1, sizeLabel: "42",
      qty: 3, amount: 300, reserved: 1, expected: 5, received: 10, shipped: 7,
      byWarehouse: [{ warehouseId: FF, qty: 2 }, { warehouseId: TRANSIT, qty: 1 }],
    }),
    row({
      variantId: "v2", productId: "p1", article: "NV-836-02", imtId: 1, sizeLabel: "44",
      qty: 2, amount: 200, reserved: 0, expected: 0, received: 4, shipped: 2,
      byWarehouse: [{ warehouseId: FF, qty: 2 }],
    }),
    row({
      variantId: "v3", productId: "p2", article: "NV-836-04", imtId: 1, sizeLabel: "42",
      qty: 6, amount: 900, reserved: 2, expected: 1, received: 8, shipped: 2,
      byWarehouse: [{ warehouseId: TRANSIT, qty: 6 }],
    }),
  ]);
  assert.equal(models.length, 1);
  const [model] = models;
  const [first, second] = model.colors;
  assert.deepEqual(first.totals, {
    qty: 5, amount: 500, reserved: 1, expected: 5, received: 14, shipped: 9,
    byWarehouse: { [FF]: 4, [TRANSIT]: 1 },
  });
  assert.deepEqual(second.totals, {
    qty: 6, amount: 900, reserved: 2, expected: 1, received: 8, shipped: 2,
    byWarehouse: { [TRANSIT]: 6 },
  });
  assert.deepEqual(model.totals, {
    qty: 11, amount: 1400, reserved: 3, expected: 6, received: 22, shipped: 11,
    byWarehouse: { [FF]: 4, [TRANSIT]: 7 },
  });
});

test("колонки партий и документов не повторяются и идут по дате", () => {
  const models = buildStockMatrix([
    row({
      variantId: "v1", sizeLabel: "42", qty: 1,
      receipts: [
        { batchId: "b2", number: "ПРМ-2026-0002", date: "2026-09-02", qty: 5, state: "posted" },
        { batchId: "b1", number: "ПРМ-2026-0001", date: "2026-09-01", qty: 3, state: "posted" },
      ],
      shipments: [
        { docId: "d2", number: "ОТГ-2026-0002", date: "2026-09-04", qty: 2, cabinetName: "Оптима", status: "draft" },
      ],
    }),
    row({
      variantId: "v2", sizeLabel: "44", qty: 1,
      receipts: [
        { batchId: "b1", number: "ПРМ-2026-0001", date: "2026-09-01", qty: 4, state: "posted" },
        { batchId: "b3", number: null, date: "2026-09-03", qty: 6, state: "expected" },
      ],
      shipments: [
        { docId: "d1", number: "ОТГ-2026-0001", date: "2026-09-03", qty: 1, cabinetName: "Оптима", status: "posted" },
        { docId: "d2", number: "ОТГ-2026-0002", date: "2026-09-04", qty: 1, cabinetName: "Оптима", status: "draft" },
      ],
    }),
  ]);
  const { columns } = models[0].colors[0];
  assert.deepEqual(columns.receipts.map((column) => column.id), ["b1", "b2", "b3"]);
  assert.deepEqual(columns.receipts.map((column) => column.state), ["posted", "posted", "expected"]);
  assert.deepEqual(columns.shipments.map((column) => column.id), ["d1", "d2"]);
  assert.deepEqual(columns.shipments.map((column) => column.status), ["posted", "draft"]);
});

test("ячейка матрицы находится по партии и документу, чужая — пустая", () => {
  const size = row({
    receipts: [{ batchId: "b1", number: "ПРМ-2026-0001", date: "2026-09-01", qty: 3, state: "posted" }],
    shipments: [{ docId: "d1", number: "ОТГ-2026-0001", date: "2026-09-03", qty: 1, cabinetName: null, status: "posted" }],
  });
  assert.equal(receiptCell(size, "b1")?.qty, 3);
  assert.equal(receiptCell(size, "nope"), null);
  assert.equal(shipmentCell(size, "d1")?.qty, 1);
  assert.equal(shipmentCell(size, "nope"), null);
});

test("размер без остатка, но с ожиданием, попадает в дерево", () => {
  // ТЗ хочет видеть «ожидается 45» у размера, которого на складе ещё нет.
  const models = buildStockMatrix([
    row({ variantId: "v1", sizeLabel: "42", qty: 0, expected: 45,
      receipts: [{ batchId: "b1", number: null, date: "2026-09-05", qty: 45, state: "expected" }] }),
  ]);
  assert.equal(models.length, 1);
  assert.equal(models[0].colors[0].sizes.length, 1);
  assert.equal(models[0].totals.expected, 45);
  assert.equal(models[0].totals.qty, 0);
});

test("пустой список строк — пустое дерево", () => {
  assert.deepEqual(buildStockMatrix([]), []);
});

test("подпись модели и цвета берутся из карточки, когда они записаны", () => {
  const models = buildStockMatrix([
    row({ imtId: 5, model: "Ветровка Норвия", color: "бежевый", article: "NV-836-02", qty: 1 }),
  ]);
  assert.equal(models[0].label, "Ветровка Норвия");
  assert.equal(models[0].colors[0].color, "бежевый");
});
