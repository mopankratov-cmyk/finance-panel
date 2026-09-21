import { isWbWarehouse } from "@/lib/wb/realStock";

/**
 * Фильтр остатков по складам WB.
 *
 * Общий остаток — сумма по всем складным строкам отчёта WB, но реален только
 * остаток на «Склад WB» (FBW и FBS): склады по городам после пожара пусты, а их
 * цифры в отчёте — фантом (lib/wb/realStock.ts). Поэтому «корректный остаток» —
 * это остаток по «Склад WB», и экран считает его по умолчанию, а остальные
 * склады остаются доступны для сверки.
 *
 * Чистые функции без React и базы: каждое число в таблице проверяется тестом.
 */

export interface WarehouseQty { warehouse: string; quantity: number }

export interface WarehouseOption {
  warehouse: string;
  quantity: number;
  /** Сколько артикулов лежит на складе. */
  skus: number;
  /** «Склад WB» — единственное место с реальным остатком. */
  wb: boolean;
}

/** Склады, на которых есть товар, — с суммой остатка и числом артикулов. */
export function warehouseOptions(rows: readonly { warehouses: readonly WarehouseQty[] }[]): WarehouseOption[] {
  const byName = new Map<string, WarehouseOption>();
  for (const row of rows) {
    for (const entry of row.warehouses) {
      if (!(entry.quantity > 0)) continue;
      const current = byName.get(entry.warehouse) ?? { warehouse: entry.warehouse, quantity: 0, skus: 0, wb: isWbWarehouse(entry.warehouse) };
      current.quantity += entry.quantity;
      current.skus += 1;
      byName.set(entry.warehouse, current);
    }
  }
  return [...byName.values()].sort((a, b) => b.quantity - a.quantity || a.warehouse.localeCompare(b.warehouse, "ru"));
}

export interface StockRowLike {
  quantity: number;
  daysLeft: number | null;
  /** Среднесуточные заказы за 30 дней; по нему пересчитывается «хватит дней». */
  avgDaily?: number;
  warehouseCount: number;
  topWarehouses: WarehouseQty[];
  warehouses: WarehouseQty[];
}

/**
 * Строка остатков «как если бы в отчёте были только выбранные склады».
 * `selected === null` — все склады, строка возвращается как есть: там остаток
 * считает сервер, и подменять его пересчётом без нужды незачем.
 *
 * «Хватит дней» пересчитывается по остатку выбранных складов: иначе колонка
 * отвечала бы на вопрос про весь остаток, а рядом стоял бы остаток склада.
 * Колонки «в пути» от склада не зависят вовсе (WB отдаёт их одной строкой на
 * артикул) и здесь не трогаются.
 */
export function applyWarehouseFilter<T extends StockRowLike>(row: T, selected: ReadonlySet<string> | null): T {
  if (selected === null) return row;
  const warehouses = row.warehouses.filter((entry) => selected.has(entry.warehouse));
  const quantity = warehouses.reduce((sum, entry) => sum + entry.quantity, 0);
  const avgDaily = row.avgDaily ?? 0;
  return {
    ...row,
    quantity,
    daysLeft: avgDaily > 0 ? Math.round(quantity / avgDaily) : null,
    warehouseCount: warehouses.length,
    topWarehouses: warehouses.slice(0, 5),
    warehouses,
  };
}

/** Выбрано всё — это то же, что «без фильтра»: сервер считает точнее пересчёта. */
export function normalizeSelection(selected: ReadonlySet<string>, options: readonly WarehouseOption[]): Set<string> | null {
  return options.length > 0 && options.every((option) => selected.has(option.warehouse)) ? null : new Set(selected);
}

/** Переключить склад. `current === null` — сейчас выбраны все. */
export function toggleWarehouse(current: ReadonlySet<string> | null, warehouse: string, options: readonly WarehouseOption[]): Set<string> | null {
  const base = new Set(current ?? options.map((option) => option.warehouse));
  if (base.has(warehouse)) base.delete(warehouse);
  else base.add(warehouse);
  return normalizeSelection(base, options);
}

/**
 * Только «Склад WB» — корректный остаток. Нет такого склада в данных — null:
 * без него остаток показывать по всем складам лучше, чем нулём по всем.
 */
export function onlyWbWarehouses(options: readonly WarehouseOption[]): Set<string> | null {
  const picked = new Set(options.filter((option) => option.wb).map((option) => option.warehouse));
  return picked.size === 0 ? null : normalizeSelection(picked, options);
}

/** Выбран ли ровно «Склад WB» (и ничего сверх него). */
export function isWbOnlySelection(selected: ReadonlySet<string> | null): boolean {
  return selected !== null && selected.size > 0 && [...selected].every(isWbWarehouse);
}

export function selectionLabel(selected: ReadonlySet<string> | null, options: readonly WarehouseOption[]): string {
  if (selected === null) return `все (${options.length})`;
  if (isWbOnlySelection(selected)) return "«Склад WB»";
  return `${selected.size} из ${options.length}`;
}
