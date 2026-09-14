export const SHIPMENT_STATUSES = ["planned", "shipped", "customs", "arrived", "received", "cancelled"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface ShipmentItem {
  nmId: number;
  article: string;
  quantity: number;
}

export interface SupplierShipmentInput {
  id?: string;
  orderId: string;
  carrier: string;
  route: string;
  status: ShipmentStatus;
  eta: string | null;
  shippedAt: string | null;
  arrivedAt: string | null;
  receivedAt: string | null;
  note: string;
  items: ShipmentItem[];
}

type ValidationResult =
  | { ok: true; value: SupplierShipmentInput }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function nullableDate(value: unknown): string | null {
  const candidate = text(value, 10);
  return ISO_DATE.test(candidate) ? candidate : null;
}

function nullableTimestamp(value: unknown): string | null {
  const candidate = text(value, 40);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

/**
 * Отгрузка — логистический факт, а не план заказа: не даём её создать без
 * привязки к существующему заказу (orderId обязателен и проверяется на
 * формат здесь; что заказ реально существует и виден в кабинете — проверяет
 * роут, у валидатора для этого нет доступа к БД).
 */
export function normalizeShipmentPayload(raw: unknown, forced?: { id?: string; orderId?: string }): ValidationResult {
  const source = record(raw);
  const id = text(forced?.id ?? source.id, 60) || undefined;
  const orderId = text(forced?.orderId ?? source.orderId, 60);
  const status = text(source.status, 20) as ShipmentStatus;

  if (!UUID.test(orderId)) return { ok: false, error: "Укажите корректный заказ" };
  if (!SHIPMENT_STATUSES.includes(status)) return { ok: false, error: "Некорректный статус отгрузки" };

  const itemRows = Array.isArray(source.items) ? source.items : [];
  const items: ShipmentItem[] = [];
  const seenNmIds = new Set<number>();
  for (let index = 0; index < itemRows.length; index += 1) {
    const item = record(itemRows[index]);
    const nmId = number(item.nmId);
    const quantity = number(item.quantity);
    if (!Number.isSafeInteger(nmId) || nmId <= 0) return { ok: false, error: `Позиция ${index + 1}: некорректный nmId` };
    if (seenNmIds.has(nmId)) return { ok: false, error: `Позиция ${index + 1}: nmId ${nmId} уже добавлен` };
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10_000_000) return { ok: false, error: `Позиция ${index + 1}: количество должно быть целым и больше нуля` };
    seenNmIds.add(nmId);
    items.push({ nmId, article: text(item.article, 200), quantity });
  }
  if (status !== "planned" && status !== "cancelled" && items.length === 0) {
    return { ok: false, error: "Укажите хотя бы одну позицию в отгрузке" };
  }

  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      orderId,
      carrier: text(source.carrier, 200),
      route: text(source.route, 300),
      status,
      eta: nullableDate(source.eta),
      shippedAt: nullableTimestamp(source.shippedAt),
      arrivedAt: nullableTimestamp(source.arrivedAt),
      receivedAt: nullableTimestamp(source.receivedAt),
      note: text(source.note, 2_000),
      items,
    },
  };
}
