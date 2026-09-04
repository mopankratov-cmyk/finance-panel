// Задание на отгрузку (ТЗ команды, п. 4).
//
// Задание — документ stock_docs со статусом draft и строками stock_doc_lines.
// Пока оно draft, его строки — резерв: остаток в регистре не меняется, но
// «доступно» уже меньше. Подтверждение фулфилментом проводит обычную отгрузку
// теми же строками и закрывает тот же документ (post_shipment_task).

export type ShipmentTaskStatus = "draft" | "posted" | "cancelled" | "reversed";

export const TASK_STATUS_LABEL: Record<ShipmentTaskStatus, string> = {
  draft: "ждёт ФФ",
  posted: "отгружено",
  cancelled: "отменено",
  reversed: "сторнировано",
};

export interface ShipmentTaskLine {
  id: number;
  variantId: string;
  productId: string;
  article: string;
  sizeLabel: string;
  barcode: string | null;
  nmId: number | null;
  photoUrl: string | null;
  /** Сколько поставлено в задание. */
  qty: number;
  /** Сколько фактически отгружено; null, пока задание не выполнено. */
  shippedQty: number | null;
  /** Остаток на складе задания на момент чтения — то, что ФФ видит рядом с заданием. */
  onHand: number;
}

export interface ShipmentTaskRow {
  id: string;
  number: string;
  status: ShipmentTaskStatus;
  warehouseId: string | null;
  warehouseName: string | null;
  cabinetId: string | null;
  cabinetName: string | null;
  marketplace: "wb" | "ozon" | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** Дата документа: у выполненного — момент отгрузки. */
  occurredAt: string;
  qty: number;
  shippedQty: number | null;
  amount: number | null;
  lines: ShipmentTaskLine[];
}

export interface ShipmentTasksResponse {
  rows: ShipmentTaskRow[];
  /** Сколько заданий ждут фулфилмента — для заголовка и полосы дел. */
  pending: number;
}

export interface TaskLineInput {
  variantId: string;
  qty: number;
}

/** Резерв по размеру: сумма строк всех черновиков. Ключ — «склад:размер»,
 *  потому что задание держит товар на конкретном складе. */
export function reservedByVariant(
  lines: { warehouseId: string | null; variantId: string; qty: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of lines) {
    if (!line.warehouseId) continue;
    const key = reservationKey(line.warehouseId, line.variantId);
    map.set(key, (map.get(key) ?? 0) + Math.max(0, Number(line.qty) || 0));
  }
  return map;
}

export const reservationKey = (warehouseId: string, variantId: string) => `${warehouseId}:${variantId}`;

/** Что не влезает в доступное: строки, где просят больше, чем «остаток − чужой резерв». */
export function overReserved(
  lines: TaskLineInput[],
  available: Map<string, number>,
): TaskLineInput[] {
  const wanted = new Map<string, number>();
  for (const line of lines) wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.qty);
  return [...wanted.entries()]
    .filter(([variantId, qty]) => qty > (available.get(variantId) ?? 0))
    .map(([variantId, qty]) => ({ variantId, qty }));
}
