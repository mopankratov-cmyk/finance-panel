/**
 * Фильтр остатков по складам WB.
 *
 * Общий остаток артикула — сумма по всем складским строкам отчёта WB, а в ней
 * лежат склады, откуда товар не продаётся: «Склад WB РФ» — это товар в пути
 * между складами WB, а не остаток, склады после пожара, куда поставок не будет.
 * Отчёт по Retail Family 02.09.2026 показал 14 944 шт при 2 370 доступных на
 * витрине. Поэтому «корректный остаток» — это остаток по тем складам, которые
 * человек выбрал, а не общая сумма.
 *
 * Чистые функции без React и базы: каждое число в таблице проверяется тестом.
 */

export interface WarehouseQty { warehouse: string; quantity: number }

/**
 * Склад-транзит: «Склад WB РФ» — товар в пути между складами WB. В отчёте
 * WB это дизъюнктная строка, входящая в «Всего», но продать этот товар нельзя,
 * пока он не приехал на склад. Совпадает и с прежним агрегатом «Склад WB»
 * (warehouseId −999999), который отдавал старый отчёт.
 */
export const isTransitWarehouse = (name: string): boolean => /^Склад\s+WB/i.test(name.trim());

export interface WarehouseOption {
  warehouse: string;
  quantity: number;
  /** Сколько артикулов лежит на складе. */
  skus: number;
  transit: boolean;
}

/** Склады, на которых есть товар, — с суммой остатка и числом артикулов. */
export function warehouseOptions(rows: readonly { warehouses: readonly WarehouseQty[] }[]): WarehouseOption[] {
  const byName = new Map<string, WarehouseOption>();
  for (const row of rows) {
    for (const entry of row.warehouses) {
      if (!(entry.quantity > 0)) continue;
      const current = byName.get(entry.warehouse) ?? { warehouse: entry.warehouse, quantity: 0, skus: 0, transit: isTransitWarehouse(entry.warehouse) };
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

/** Все склады, кроме транзитных: «Склад WB РФ» и прежний агрегат «Склад WB». */
export function withoutTransit(options: readonly WarehouseOption[]): Set<string> | null {
  const picked = new Set(options.filter((option) => !option.transit).map((option) => option.warehouse));
  return normalizeSelection(picked, options);
}

export function selectionLabel(selected: ReadonlySet<string> | null, options: readonly WarehouseOption[]): string {
  if (selected === null) return `все (${options.length})`;
  return `${selected.size} из ${options.length}`;
}
