import type { ShipmentStatus, SupplierShipmentInput } from "./shipments";

export interface SupplierShipmentView extends SupplierShipmentInput {
  id: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type DbRecord = Record<string, unknown>;

const rows = (value: unknown): DbRecord[] => Array.isArray(value) ? value.filter((entry): entry is DbRecord => Boolean(entry) && typeof entry === "object") : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const nullableString = (value: unknown): string | null => typeof value === "string" && value ? value : null;
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

export const SHIPMENT_SELECT = "*, supplier_shipment_items(nm_id, article, quantity)";

export function shipmentFromDb(row: DbRecord): SupplierShipmentView {
  return {
    id: string(row.id),
    orderId: string(row.order_id),
    carrier: string(row.carrier),
    route: string(row.route),
    status: string(row.status) as ShipmentStatus,
    eta: nullableString(row.eta),
    shippedAt: nullableString(row.shipped_at),
    arrivedAt: nullableString(row.arrived_at),
    receivedAt: nullableString(row.received_at),
    note: string(row.note),
    items: rows(row.supplier_shipment_items).map((item) => ({
      nmId: number(item.nm_id),
      article: string(item.article),
      quantity: number(item.quantity),
    })),
    createdBy: nullableString(row.created_by),
    updatedBy: nullableString(row.updated_by),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at),
  };
}
