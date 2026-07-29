export interface PlannedSupplyPosition { barcode: string; quantity: number }
export interface WbSupplyGood { barcode: string; quantity: number }
export interface PlannedPackageLine { container: string; barcode: string; quantity: number }
export interface WbSupplyPackage { packageCode: string; quantity: number; barcodes: { barcode: string; quantity: number }[] }

export interface QuantityMismatch {
  key: string;
  expected: number;
  actual: number;
}

export interface SupplyComparison {
  ok: boolean;
  expectedTotal: number;
  actualTotal: number;
  missing: QuantityMismatch[];
  extra: QuantityMismatch[];
  mismatched: QuantityMismatch[];
}

const clean = (value: unknown, max = 255) => String(value ?? "").normalize("NFKC").trim().slice(0, max);
const key = (value: unknown) => clean(value, 160).toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]+/gi, "");
const qty = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 1000) / 1000 : 0;
};

export function normalizeWbSupplyId(value: unknown): number | null {
  const normalized = clean(value, 40).replace(/\s/g, "");
  if (!/^\d{1,18}$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function supplyWarehouseMatches(plannedWarehouse: string, detail: Record<string, unknown>): boolean {
  const planned = key(plannedWarehouse);
  if (!planned) return false;
  // Транзитный склад не является складом назначения и не должен позволять
  // привязать поставку к чужой строке распределения.
  const candidates = [detail.warehouseName, detail.actualWarehouseName]
    .map(key)
    .filter(Boolean);
  return candidates.includes(planned);
}

function quantities(rows: { key: string; quantity: number }[]) {
  const result = new Map<string, number>();
  for (const row of rows) {
    const normalized = key(row.key);
    if (!normalized) continue;
    result.set(normalized, Math.round(((result.get(normalized) ?? 0) + qty(row.quantity)) * 1000) / 1000);
  }
  return result;
}

function compareMaps(expected: Map<string, number>, actual: Map<string, number>): SupplyComparison {
  const missing: QuantityMismatch[] = [];
  const extra: QuantityMismatch[] = [];
  const mismatched: QuantityMismatch[] = [];
  for (const [rowKey, expectedQty] of expected) {
    const actualQty = actual.get(rowKey) ?? 0;
    if (!actual.has(rowKey)) missing.push({ key: rowKey, expected: expectedQty, actual: 0 });
    else if (Math.abs(expectedQty - actualQty) > 0.001) mismatched.push({ key: rowKey, expected: expectedQty, actual: actualQty });
  }
  for (const [rowKey, actualQty] of actual) if (!expected.has(rowKey)) extra.push({ key: rowKey, expected: 0, actual: actualQty });
  const expectedTotal = [...expected.values()].reduce((sum, value) => sum + value, 0);
  const actualTotal = [...actual.values()].reduce((sum, value) => sum + value, 0);
  return { ok: !missing.length && !extra.length && !mismatched.length, expectedTotal, actualTotal, missing, extra, mismatched };
}

export function compareWbSupplyGoods(planned: PlannedSupplyPosition[], actual: WbSupplyGood[]): SupplyComparison {
  return compareMaps(
    quantities(planned.map((row) => ({ key: row.barcode, quantity: row.quantity }))),
    quantities(actual.map((row) => ({ key: row.barcode, quantity: row.quantity }))),
  );
}

export function compareWbSupplyPackages(planned: PlannedPackageLine[], actual: WbSupplyPackage[]): SupplyComparison {
  const expected = quantities(planned.map((row) => ({ key: `${row.container}|${row.barcode}`, quantity: row.quantity })));
  const actualRows = actual.flatMap((pack) => pack.barcodes.map((row) => ({ key: `${pack.packageCode}|${row.barcode}`, quantity: row.quantity })));
  return compareMaps(expected, quantities(actualRows));
}

export function supplyStatusLabel(statusId: unknown) {
  return ({ 1: "не запланирована", 2: "запланирована", 3: "отгрузка разрешена", 4: "приёмка", 5: "принята", 6: "разгружена у ворот" } as Record<number, string>)[Number(statusId)] ?? `статус ${String(statusId ?? "—")}`;
}
