import type { SupplierInput, SupplierView } from "./suppliers";

type DbRecord = Record<string, unknown>;

const string = (value: unknown): string => typeof value === "string" ? value : "";
const nullableString = (value: unknown): string | null => typeof value === "string" && value ? value : null;
const nullableNumber = (value: unknown): number | null => value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

export const SUPPLIER_SELECT = "id, name, country, tax_id, currency, production_days, min_order_qty, contact_name, contact_phone, note, is_active, created_by, created_at, updated_at";

export function supplierFromDb(row: DbRecord): SupplierView {
  return {
    id: string(row.id),
    name: string(row.name),
    country: string(row.country),
    taxId: string(row.tax_id),
    currency: string(row.currency) as SupplierInput["currency"],
    productionDays: number(row.production_days),
    minOrderQty: nullableNumber(row.min_order_qty),
    contactName: string(row.contact_name),
    contactPhone: string(row.contact_phone),
    note: string(row.note),
    isActive: Boolean(row.is_active),
    createdBy: nullableString(row.created_by),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at),
  };
}
