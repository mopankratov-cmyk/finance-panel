export interface DistributionWarehouseShare {
  name: string;
  pct: number;
}

export interface SupplyDistributionSettings {
  cabinetId: string;
  warehouses: DistributionWarehouseShare[];
  excludedNmIds: number[];
  minBatch: number;
  palletLiters: number;
}

type SettingsResult =
  | { ok: true; value: SupplyDistributionSettings }
  | { ok: false; error: string };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 200): string => typeof value === "string" ? value.trim().slice(0, max) : "";
const number = (value: unknown): number => typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;

export function normalizeDistributionSettingsPayload(raw: unknown, forcedCabinetId?: string): SettingsResult {
  const source = record(raw);
  const cabinetId = text(forcedCabinetId ?? source.cabinetId, 60);
  const minBatch = number(source.minBatch);
  const palletLiters = number(source.palletLiters);
  if (!cabinetId) return { ok: false, error: "Укажите кабинет" };
  if (!Number.isInteger(minBatch) || minBatch < 0 || minBatch > 1_000_000) return { ok: false, error: "Минимальная партия должна быть целым числом от 0 до 1 000 000" };
  if (!Number.isFinite(palletLiters) || palletLiters < 0 || palletLiters > 100_000) return { ok: false, error: "Некорректный объём паллеты" };

  const warehouseRows = Array.isArray(source.warehouses) ? source.warehouses : [];
  if (warehouseRows.length === 0) return { ok: false, error: "Добавьте хотя бы один склад" };
  if (warehouseRows.length > 30) return { ok: false, error: "Слишком много складов в сценарии" };
  const warehouses: DistributionWarehouseShare[] = [];
  const names = new Set<string>();
  for (let index = 0; index < warehouseRows.length; index += 1) {
    const row = record(warehouseRows[index]);
    const name = text(row.name, 200);
    const pct = number(row.pct);
    if (!name) return { ok: false, error: `Склад ${index + 1}: укажите название` };
    if (names.has(name.toLocaleLowerCase("ru-RU"))) return { ok: false, error: `Склад ${index + 1}: название повторяется` };
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, error: `Склад ${index + 1}: доля должна быть от 0 до 100%` };
    names.add(name.toLocaleLowerCase("ru-RU"));
    warehouses.push({ name, pct: Math.round(pct * 100) / 100 });
  }
  const total = warehouses.reduce((sum, warehouse) => sum + warehouse.pct, 0);
  if (Math.abs(total - 100) > 0.01) return { ok: false, error: `Сумма долей должна быть 100%, сейчас ${Math.round(total * 100) / 100}%` };

  const excludedRows = Array.isArray(source.excludedNmIds) ? source.excludedNmIds : [];
  if (excludedRows.length > 20_000) return { ok: false, error: "Слишком много исключённых SKU" };
  const excludedNmIds: number[] = [];
  const excluded = new Set<number>();
  for (const rawNmId of excludedRows) {
    const nmId = number(rawNmId);
    if (!Number.isSafeInteger(nmId) || nmId <= 0) return { ok: false, error: "В исключениях есть некорректный nmId" };
    if (!excluded.has(nmId)) excludedNmIds.push(nmId);
    excluded.add(nmId);
  }

  return { ok: true, value: { cabinetId, warehouses, excludedNmIds, minBatch, palletLiters } };
}

export function allocateByWarehouse(total: number, warehouses: DistributionWarehouseShare[]): number[] {
  const quantity = Math.max(0, Math.round(total));
  if (!warehouses.length || quantity === 0) return warehouses.map(() => 0);
  const raw = warehouses.map((warehouse) => quantity * warehouse.pct / 100);
  const result = raw.map(Math.floor);
  let remainder = quantity - result.reduce((sum, value) => sum + value, 0);
  const byFraction = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index += 1) result[byFraction[index % byFraction.length].index] += 1;
  return result;
}

export function withoutClosedWarehouses(warehouses: DistributionWarehouseShare[], closedNames: Set<string>): DistributionWarehouseShare[] {
  const open = warehouses.filter((warehouse) => !closedNames.has(warehouse.name));
  if (!open.length) return warehouses;
  const openTotal = open.reduce((sum, warehouse) => sum + warehouse.pct, 0);
  const equal = openTotal <= 0;
  const raw = warehouses.map((warehouse) => closedNames.has(warehouse.name) ? 0 : equal ? 100 / open.length : warehouse.pct * 100 / openTotal);
  const rounded = raw.map((pct) => Math.round(pct * 100) / 100);
  const diff = Math.round((100 - rounded.reduce((sum, pct) => sum + pct, 0)) * 100) / 100;
  const firstOpen = warehouses.findIndex((warehouse) => !closedNames.has(warehouse.name));
  if (firstOpen >= 0) rounded[firstOpen] += diff;
  return warehouses.map((warehouse, index) => ({ name: warehouse.name, pct: rounded[index] }));
}
