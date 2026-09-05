/** Вид склада. «В пути» — не метафора, а такое же место хранения: пока фура едет
 *  из Уссурийска в Москву, товар где-то лежит, и остаток обязан это показывать. */
export type WarehouseKind = "own" | "fulfillment" | "transit";

const KINDS: WarehouseKind[] = ["own", "fulfillment", "transit"];

export const parseWarehouseKind = (value: unknown): WarehouseKind =>
  KINDS.includes(value as WarehouseKind) ? (value as WarehouseKind) : "own";

export const warehouseKindLabel = (kind: WarehouseKind): string =>
  kind === "fulfillment" ? "фулфилмент" : kind === "transit" ? "в пути" : "свой склад";

/** Короткая пометка рядом с названием в выпадающих списках. */
export const warehouseKindSuffix = (kind: WarehouseKind): string =>
  kind === "fulfillment" ? " · ФФ" : kind === "transit" ? " · в пути" : "";

/**
 * Склады, на которых сегодня работают.
 *
 * Кнопка «В архив» на вкладке «Склады» меняла только подпись: сам склад
 * оставался во ВСЕХ рабочих списках — приёмка, отгрузка, перемещение брали
 * `warehouses.map(...)` без разбора. Человек убирал склад из работы и видел
 * его там же, где и раньше.
 *
 * Выбранный склад остаётся в списке, даже если он в архиве: иначе документ,
 * уже привязанный к нему, потерял бы своё значение в выпадающем списке и
 * молча переехал бы на чужой склад.
 */
export function operationalWarehouses<T extends { id: string; isActive?: boolean }>(
  warehouses: T[],
  keepId?: string | null,
): T[] {
  return warehouses.filter((warehouse) => warehouse.isActive !== false || warehouse.id === keepId);
}
