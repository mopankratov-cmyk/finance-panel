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
