import { PURCHASE_CURRENCIES, type PurchaseCurrency } from "./order";

export const OWNERSHIP_TRANSFER_MOMENTS = ["after_supplier_shipment", "after_carrier", "after_customs", "after_warehouse_receipt", "other"] as const;
export type OwnershipTransferMoment = (typeof OWNERSHIP_TRANSFER_MOMENTS)[number];

export interface SupplierContractInput {
  id?: string;
  supplierId: string;
  legalEntityId: string;
  number: string;
  signedAt: string | null;
  currency: PurchaseCurrency;
  prepaymentPercent: number | null;
  prepaymentTerms: string;
  finalPaymentTerms: string;
  productionDays: number | null;
  ownershipTransferMoment: OwnershipTransferMoment;
  ownershipTransferNote: string;
  countryOfOrigin: string;
  deliveryTerms: string;
  transportTerms: string;
  customsTerms: string;
  isActive: boolean;
  note: string;
}

export interface SupplierContractView extends SupplierContractInput {
  id: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

type ValidationResult =
  | { ok: true; value: SupplierContractInput }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * Договор — пара (поставщик, юрлицо), не сам поставщик: то, на каких
 * условиях и с какого момента товар становится активом, зависит от того, кто
 * покупатель, а не только от того, кто продавец.
 */
export function normalizeSupplierContractPayload(raw: unknown, forced?: { id?: string }): ValidationResult {
  const source = record(raw);
  const id = text(forced?.id ?? source.id, 60) || undefined;
  const supplierId = text(source.supplierId, 60);
  const legalEntityId = text(source.legalEntityId, 60);
  const contractNumber = text(source.number, 200);
  const signedAtRaw = text(source.signedAt, 10);
  const signedAt = DATE.test(signedAtRaw) ? signedAtRaw : null;
  const currencyRaw = text(source.currency, 3);
  const currency = (currencyRaw || "CNY") as PurchaseCurrency;
  const ownershipRaw = text(source.ownershipTransferMoment, 30);
  const ownershipTransferMoment = (ownershipRaw || "after_customs") as OwnershipTransferMoment;
  const isActive = typeof source.isActive === "boolean" ? source.isActive : true;

  if (!UUID.test(supplierId)) return { ok: false, error: "Укажите поставщика" };
  if (!UUID.test(legalEntityId)) return { ok: false, error: "Укажите юрлицо" };
  if (!contractNumber) return { ok: false, error: "Укажите номер договора" };
  if (!PURCHASE_CURRENCIES.includes(currency)) return { ok: false, error: "Поддерживаются валюты CNY, RUB и USD" };
  if (!OWNERSHIP_TRANSFER_MOMENTS.includes(ownershipTransferMoment)) return { ok: false, error: "Укажите момент перехода права собственности" };

  let prepaymentPercent: number | null = null;
  if (source.prepaymentPercent !== null && source.prepaymentPercent !== undefined && source.prepaymentPercent !== "") {
    const parsed = number(source.prepaymentPercent);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return { ok: false, error: "Предоплата — от 0 до 100%" };
    prepaymentPercent = parsed;
  }

  let productionDays: number | null = null;
  if (source.productionDays !== null && source.productionDays !== undefined && source.productionDays !== "") {
    const parsed = number(source.productionDays);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) return { ok: false, error: "Срок производства должен быть от 0 до 365 дней" };
    productionDays = parsed;
  }

  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      supplierId,
      legalEntityId,
      number: contractNumber,
      signedAt,
      currency,
      prepaymentPercent,
      prepaymentTerms: text(source.prepaymentTerms, 1_000),
      finalPaymentTerms: text(source.finalPaymentTerms, 1_000),
      productionDays,
      ownershipTransferMoment,
      ownershipTransferNote: text(source.ownershipTransferNote, 1_000),
      countryOfOrigin: text(source.countryOfOrigin, 200),
      deliveryTerms: text(source.deliveryTerms, 1_000),
      transportTerms: text(source.transportTerms, 1_000),
      customsTerms: text(source.customsTerms, 1_000),
      isActive,
      note: text(source.note, 5_000),
    },
  };
}

/** Стадии supplier_shipments.status, при которых момент перехода права уже
 *  наступил — используется и на сервере (API-поле ownershipTransferred), и
 *  нигде больше: сопоставление одно, чтобы не разойтись в двух местах. */
const TRANSFER_AT_STAGE: Record<Exclude<OwnershipTransferMoment, "other">, string[]> = {
  after_supplier_shipment: ["shipped", "customs", "arrived", "received"],
  after_carrier: ["shipped", "customs", "arrived", "received"],
  after_customs: ["customs", "arrived", "received"],
  after_warehouse_receipt: ["received"],
};

/** null — нет однозначного правила (договора нет, момент не определён, или
 *  ownership_transfer_moment='other') — бейдж на экране просто не рисуется. */
export function isOwnershipTransferred(moment: OwnershipTransferMoment | null, shipmentStatus: string): boolean | null {
  if (!moment || moment === "other") return null;
  return TRANSFER_AT_STAGE[moment].includes(shipmentStatus);
}
