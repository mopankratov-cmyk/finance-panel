/**
 * Схема продажи по типу склада отгрузки.
 *
 * WB отдаёт в статистике заказов и продаж поле `warehouseType` — текст вроде
 * «Склад продавца». Мы храним его сырым (`wb_orders.warehouse_type`) и приводим
 * к схеме здесь, чтобы новое значение на стороне WB правилось в одном месте.
 *
 * ⚠️ Граница проходит по СКЛАДУ, а не по способу доставки: отгрузка со склада
 * продавца — это и FBS, и DBS. Отличить их по этому полю нельзя, поэтому в
 * интерфейсе такую схему честнее подписывать «склад продавца», а не «FBS».
 */
export type WbScheme = "fbs" | "fbw";

/** Значения WB, означающие отгрузку со склада продавца. Сравнение регистронезависимое. */
const SELLER_WAREHOUSE_MARKERS = ["склад продавца", "склад поставщика"];

/**
 * `null` — тип склада неизвестен: строка записана до появления колонки либо WB
 * прислал пустое значение. Это НЕ то же самое, что FBW: молчание честнее догадки.
 */
export function wbSchemeFromWarehouseType(warehouseType: string | null | undefined): WbScheme | null {
  const value = String(warehouseType ?? "").trim().toLowerCase();
  if (!value) return null;
  return SELLER_WAREHOUSE_MARKERS.some((marker) => value.includes(marker)) ? "fbs" : "fbw";
}

export const WB_SCHEME_LABELS: Record<WbScheme, string> = {
  fbs: "Склад продавца (FBS/DBS)",
  fbw: "Склад WB (FBW)",
};

/** Короткая подпись для фильтров и бейджей. */
export const WB_SCHEME_SHORT_LABELS: Record<WbScheme, string> = {
  fbs: "FBS",
  fbw: "FBW",
};
