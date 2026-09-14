export const DISCREPANCY_RESOLUTIONS = ["wait_restock", "reduce_debt", "refund", "accept_replacement", "claim"] as const;
export type DiscrepancyResolution = (typeof DISCREPANCY_RESOLUTIONS)[number];

export const DISCREPANCY_ACT_STATUSES = ["open", "resolved"] as const;
export type DiscrepancyActStatus = (typeof DISCREPANCY_ACT_STATUSES)[number];

export interface DiscrepancyActInput {
  id?: string;
  purchaseOrderId: string;
  batchId: string;
  resolution: DiscrepancyResolution;
  status: DiscrepancyActStatus;
  note: string;
}

type ValidationResult =
  | { ok: true; value: DiscrepancyActInput }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Акт — решение по уже посчитанному расхождению одной партии приёмки, а не
 * новый источник цифр: expectedQty/receivedQty/defectQty читаются из
 * purchase_receipts роутом, сюда не попадают вовсе.
 */
export function normalizeDiscrepancyActPayload(raw: unknown, forced?: { id?: string; purchaseOrderId?: string; batchId?: string }): ValidationResult {
  const source = record(raw);
  const id = text(forced?.id ?? source.id, 60) || undefined;
  const purchaseOrderId = text(forced?.purchaseOrderId ?? source.purchaseOrderId, 60);
  const batchId = text(forced?.batchId ?? source.batchId, 60);
  const resolution = text(source.resolution, 30) as DiscrepancyResolution;
  const status = text(source.status, 20) as DiscrepancyActStatus || "open";

  if (!UUID.test(purchaseOrderId)) return { ok: false, error: "Укажите корректный заказ" };
  if (!UUID.test(batchId)) return { ok: false, error: "Укажите корректную партию приёмки" };
  if (!DISCREPANCY_RESOLUTIONS.includes(resolution)) return { ok: false, error: "Укажите решение по расхождению" };
  if (!DISCREPANCY_ACT_STATUSES.includes(status)) return { ok: false, error: "Некорректный статус акта" };

  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      purchaseOrderId,
      batchId,
      resolution,
      status,
      note: text(source.note, 2_000),
    },
  };
}
