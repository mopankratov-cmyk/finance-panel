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

export interface DiscrepancyReceiptLine {
  expected_qty: number;
  received_qty: number | null;
  defect_qty: number | null;
  status: "expected" | "received";
}

export interface DiscrepancySummary {
  expectedQty: number;
  receivedQty: number;
  defectQty: number;
  counted: boolean;
  short: number;
  over: number;
}

/**
 * Расхождение партии — общая точка для экрана заказа (§10.3) и расчётов с
 * поставщиком (§27.9, «к допоставке»): недовоз и излишек копятся по строкам
 * (а не по итогам, чтобы −4 одного размера и +2 другого не схлопнулись в
 * «−2»), и null/0, пока не все строки партии пересчитаны.
 */
export function summarizeDiscrepancy(lines: DiscrepancyReceiptLine[]): DiscrepancySummary {
  let expectedQty = 0;
  let receivedQty = 0;
  let defectQty = 0;
  let short = 0;
  let over = 0;
  let counted = lines.length > 0;
  for (const line of lines) {
    expectedQty += Number(line.expected_qty ?? 0);
    receivedQty += Number(line.received_qty ?? 0);
    defectQty += Number(line.defect_qty ?? 0);
    if (line.status === "expected") { counted = false; continue; }
    const diff = Number(line.received_qty ?? 0) - Number(line.expected_qty ?? 0);
    if (diff < 0) short += -diff;
    if (diff > 0) over += diff;
  }
  return { expectedQty, receivedQty, defectQty, counted, short: counted ? short : 0, over: counted ? over : 0 };
}
