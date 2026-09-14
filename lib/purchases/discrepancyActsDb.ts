import type { DiscrepancyActInput, DiscrepancyActStatus, DiscrepancyResolution } from "./discrepancyActs";

export interface DiscrepancyActView extends DiscrepancyActInput {
  id: string;
  createdBy: string | null;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

type DbRecord = Record<string, unknown>;

const string = (value: unknown): string => typeof value === "string" ? value : "";
const nullableString = (value: unknown): string | null => typeof value === "string" && value ? value : null;

export const DISCREPANCY_ACT_SELECT = "id, purchase_order_id, batch_id, resolution, status, note, created_by, created_at, resolved_by, resolved_at";

export function discrepancyActFromDb(row: DbRecord): DiscrepancyActView {
  return {
    id: string(row.id),
    purchaseOrderId: string(row.purchase_order_id),
    batchId: string(row.batch_id),
    resolution: string(row.resolution) as DiscrepancyResolution,
    status: string(row.status) as DiscrepancyActStatus,
    note: string(row.note),
    createdBy: nullableString(row.created_by),
    createdAt: string(row.created_at),
    resolvedBy: nullableString(row.resolved_by),
    resolvedAt: nullableString(row.resolved_at),
  };
}
