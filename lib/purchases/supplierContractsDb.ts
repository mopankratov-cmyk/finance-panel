import type { OwnershipTransferMoment, SupplierContractInput, SupplierContractView } from "./supplierContracts";

type DbRecord = Record<string, unknown>;

const string = (value: unknown): string => typeof value === "string" ? value : "";
const nullableString = (value: unknown): string | null => typeof value === "string" && value ? value : null;
const nullableNumber = (value: unknown): number | null => value === null || value === undefined ? null : (Number.isFinite(Number(value)) ? Number(value) : null);

export const SUPPLIER_CONTRACT_SELECT = "id, supplier_id, legal_entity_id, number, signed_at, currency, prepayment_percent, prepayment_terms, final_payment_terms, production_days, ownership_transfer_moment, ownership_transfer_note, country_of_origin, delivery_terms, transport_terms, customs_terms, is_active, note, created_by, created_at, updated_at";

export function supplierContractFromDb(row: DbRecord): SupplierContractView {
  return {
    id: string(row.id),
    supplierId: string(row.supplier_id),
    legalEntityId: string(row.legal_entity_id),
    number: string(row.number),
    signedAt: nullableString(row.signed_at),
    currency: string(row.currency) as SupplierContractInput["currency"],
    prepaymentPercent: nullableNumber(row.prepayment_percent),
    prepaymentTerms: string(row.prepayment_terms),
    finalPaymentTerms: string(row.final_payment_terms),
    productionDays: nullableNumber(row.production_days),
    ownershipTransferMoment: (string(row.ownership_transfer_moment) || "after_customs") as OwnershipTransferMoment,
    ownershipTransferNote: string(row.ownership_transfer_note),
    countryOfOrigin: string(row.country_of_origin),
    deliveryTerms: string(row.delivery_terms),
    transportTerms: string(row.transport_terms),
    customsTerms: string(row.customs_terms),
    isActive: Boolean(row.is_active),
    note: string(row.note),
    createdBy: nullableString(row.created_by),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at),
  };
}
