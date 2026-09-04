// Остатки как их видит ТЗ команды: модель → цвет → размер, с колонками
// приходов и отгрузок.
//
// Роут /api/warehouse/stock отдаёт плоские строки по размеру (StockVariantRow):
// остаток по складам, резерв заданий, ожидаемое непересчитанное, и по каждому
// размеру — какие партии его приносили и какие документы увозили. Иерархию из
// этого собирает buildStockMatrix — чистая функция, чтобы её можно было
// проверить тестом без базы и без React.
//
// Продажи FBS сюда намеренно не входят (решение владельца 04.09.2026): в
// «получено» и «отгружено» считаются только приёмки и отгрузки.

import { productColorLabel, productModelKey, productModelLabel } from "@/lib/warehouse/productModel";
import type { WarehouseKind } from "@/lib/warehouse/warehouseKind";

export interface StockReceiptCell {
  batchId: string;
  number: string | null;
  /** Дата партии: ожидаемая, а после проводки — дата постановки на остаток. */
  date: string | null;
  qty: number;
  /** expected — ждём и не пересчитано; received — пересчитано, но не в остатке; posted — в остатке. */
  state: "expected" | "received" | "posted";
}

export interface StockShipmentCell {
  docId: string;
  number: string;
  date: string;
  qty: number;
  cabinetName: string | null;
  status: "draft" | "posted" | "reversed" | "cancelled";
}

export interface StockVariantRow {
  variantId: string;
  productId: string;
  article: string;
  name: string;
  sizeLabel: string;
  barcode: string | null;
  nmId: number | null;
  photoUrl: string | null;
  imtId: number | null;
  model: string | null;
  color: string | null;
  isNovelty: boolean;
  /** Остаток по всем складам юрлица. */
  qty: number;
  amount: number;
  unitCost: number;
  byWarehouse: { warehouseId: string; qty: number }[];
  /** В черновиках заданий — «размещено, но не отгружено». */
  reserved: number;
  /** Ожидается: ждём приёмки или пересчитано, но ещё не на остатке. */
  expected: number;
  /** Σ приходов, вставших на остаток. */
  received: number;
  /** Σ отгрузок (выполненных). */
  shipped: number;
  receipts: StockReceiptCell[];
  shipments: StockShipmentCell[];
}

export interface StockMatrixResponse {
  rows: StockVariantRow[];
  warehouses: { id: string; name: string; kind: WarehouseKind }[];
  totals: { qty: number; amount: number; reserved: number; expected: number; skuCount: number };
}

export interface NodeTotals {
  qty: number;
  amount: number;
  reserved: number;
  expected: number;
  received: number;
  shipped: number;
  byWarehouse: Record<string, number>;
}

export interface StockColumns {
  receipts: { id: string; number: string | null; date: string | null; state: StockReceiptCell["state"] }[];
  shipments: { id: string; number: string; date: string; status: StockShipmentCell["status"]; cabinetName: string | null }[];
}

export interface StockColorNode {
  key: string;
  productId: string;
  article: string;
  name: string;
  color: string;
  nmId: number | null;
  photoUrl: string | null;
  isNovelty: boolean;
  sizes: StockVariantRow[];
  totals: NodeTotals;
  /** Колонки матрицы «Склад» из ТЗ: партия на колонку, документ на колонку. */
  columns: StockColumns;
}

export interface StockModelNode {
  key: string;
  label: string;
  name: string;
  nmId: number | null;
  photoUrl: string | null;
  colors: StockColorNode[];
  totals: NodeTotals;
}

const emptyTotals = (): NodeTotals => ({ qty: 0, amount: 0, reserved: 0, expected: 0, received: 0, shipped: 0, byWarehouse: {} });

function addTotals(target: NodeTotals, row: StockVariantRow): void {
  target.qty += row.qty;
  target.amount += row.amount;
  target.reserved += row.reserved;
  target.expected += row.expected;
  target.received += row.received;
  target.shipped += row.shipped;
  for (const item of row.byWarehouse) {
    target.byWarehouse[item.warehouseId] = (target.byWarehouse[item.warehouseId] ?? 0) + item.qty;
  }
}

function mergeTotals(target: NodeTotals, source: NodeTotals): void {
  target.qty += source.qty;
  target.amount += source.amount;
  target.reserved += source.reserved;
  target.expected += source.expected;
  target.received += source.received;
  target.shipped += source.shipped;
  for (const [warehouseId, qty] of Object.entries(source.byWarehouse)) {
    target.byWarehouse[warehouseId] = (target.byWarehouse[warehouseId] ?? 0) + qty;
  }
}

/** Размеры идут по числу в ярлыке (40, 42-44, 46…), буквенные — по алфавиту после числовых. */
export function compareSizeLabels(a: string, b: string): number {
  const na = a.match(/\d+/);
  const nb = b.match(/\d+/);
  if (na && nb) {
    const diff = Number(na[0]) - Number(nb[0]);
    if (diff !== 0) return diff;
  } else if (na) {
    return -1;
  } else if (nb) {
    return 1;
  }
  return a.localeCompare(b, "ru");
}

const byDate = (a: string | null, b: string | null) => String(a ?? "").localeCompare(String(b ?? ""));

/**
 * Строки по размерам → модели с цветами. Строка без остатка, но с ожиданием,
 * резервом или историей тоже попадает в дерево: ТЗ хочет видеть «ожидается 45»
 * у размера, которого на складе ещё нет.
 */
export function buildStockMatrix(rows: StockVariantRow[]): StockModelNode[] {
  const models = new Map<string, StockModelNode>();
  const colors = new Map<string, StockColorNode>();

  for (const row of rows) {
    const modelKey = productModelKey({ imtId: row.imtId, model: row.model, article: row.article });
    let model = models.get(modelKey);
    if (!model) {
      model = {
        key: modelKey,
        label: productModelLabel({ model: row.model, article: row.article }),
        name: row.name,
        nmId: row.nmId,
        photoUrl: row.photoUrl,
        colors: [],
        totals: emptyTotals(),
      };
      models.set(modelKey, model);
    }

    const colorKey = `${modelKey}|${row.productId}`;
    let color = colors.get(colorKey);
    if (!color) {
      color = {
        key: colorKey,
        productId: row.productId,
        article: row.article,
        name: row.name,
        color: productColorLabel({ color: row.color, article: row.article }),
        nmId: row.nmId,
        photoUrl: row.photoUrl,
        isNovelty: row.isNovelty,
        sizes: [],
        totals: emptyTotals(),
        columns: { receipts: [], shipments: [] },
      };
      colors.set(colorKey, color);
      model.colors.push(color);
    }

    color.sizes.push(row);
    addTotals(color.totals, row);
    for (const cell of row.receipts) {
      if (!color.columns.receipts.some((column) => column.id === cell.batchId)) {
        color.columns.receipts.push({ id: cell.batchId, number: cell.number, date: cell.date, state: cell.state });
      }
    }
    for (const cell of row.shipments) {
      if (!color.columns.shipments.some((column) => column.id === cell.docId)) {
        color.columns.shipments.push({ id: cell.docId, number: cell.number, date: cell.date, status: cell.status, cabinetName: cell.cabinetName });
      }
    }
  }

  for (const model of models.values()) {
    for (const color of model.colors) {
      color.sizes.sort((a, b) => compareSizeLabels(a.sizeLabel, b.sizeLabel));
      color.columns.receipts.sort((a, b) => byDate(a.date, b.date));
      color.columns.shipments.sort((a, b) => byDate(a.date, b.date));
      mergeTotals(model.totals, color.totals);
    }
    model.colors.sort((a, b) => a.article.localeCompare(b.article, "ru"));
  }

  return [...models.values()].sort((a, b) => a.label.localeCompare(b.label, "ru"));
}

/** Значение ячейки матрицы: сколько этой партией / этим документом прошло по размеру. */
export function receiptCell(row: StockVariantRow, batchId: string): StockReceiptCell | null {
  return row.receipts.find((cell) => cell.batchId === batchId) ?? null;
}

export function shipmentCell(row: StockVariantRow, docId: string): StockShipmentCell | null {
  return row.shipments.find((cell) => cell.docId === docId) ?? null;
}
