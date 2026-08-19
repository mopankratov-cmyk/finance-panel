export const OZON_PAYER_INN = "7704217370";

export interface OzonPayoutMapping {
  cabinetId: string;
  companyId: string;
  companyName: string;
  receivingAccountId: string;
  accountKind: "dedicated_ozon" | "shared";
}

const MAPPINGS: Record<string, OzonPayoutMapping> = {
  "9142319b-34b7-4521-b80f-a2b303adbc17": {
    cabinetId: "9142319b-34b7-4521-b80f-a2b303adbc17",
    companyId: "f44db400-1374-42d8-9c71-78aed8978f95",
    companyName: "ИП Панкратов",
    receivingAccountId: "58819f26-bf1c-4fc8-9b4f-c608b0f70a4c",
    accountKind: "dedicated_ozon",
  },
  "4ab2ed44-9a0a-4397-ab56-f613760f5616": {
    cabinetId: "4ab2ed44-9a0a-4397-ab56-f613760f5616",
    companyId: "9f697ea3-e444-465f-a544-9e90cdfd0330",
    companyName: "ИП Кучеренко",
    receivingAccountId: "bc726415-0e05-442d-ab6d-7755f6505f2a",
    accountKind: "shared",
  },
};

const CABINET_DISPLAY_NAMES: Record<string, string> = {
  "9142319b-34b7-4521-b80f-a2b303adbc17": "Cosmos Shop",
  "4ab2ed44-9a0a-4397-ab56-f613760f5616": "Clerin",
};

export function ozonCabinetDisplayName(cabinetId: string, fallback = "Ozon") {
  return CABINET_DISPLAY_NAMES[cabinetId]
    ?? (fallback.replace(/^Ozon\s+/i, "").trim() || "Ozon");
}

export function getOzonPayoutMapping(cabinetId: string) {
  return MAPPINGS[cabinetId] ?? null;
}

export interface PersistedPaymentIdentity {
  status: string;
  amount: number;
  category: string;
  accountId: string;
  companyId: string | null;
  rawText: string;
}

export type OzonReceiptClassification =
  | { kind: "confirmed" }
  | { kind: "unresolved"; reason: "ambiguous" }
  | { kind: "ignored" };

const hasExactInn = (text: string, inn: string) =>
  new RegExp(`(?:^|\\D)${inn}(?:\\D|$)`).test(text);

export function classifyOzonReceipt(
  payment: PersistedPaymentIdentity,
  mapping: OzonPayoutMapping,
): OzonReceiptClassification {
  if (
    payment.status !== "done"
    || payment.amount <= 0
    || payment.category.trim() !== "Продажи на МП"
    || payment.accountId !== mapping.receivingAccountId
  ) {
    return { kind: "ignored" };
  }
  if (payment.companyId && payment.companyId !== mapping.companyId) {
    return { kind: "unresolved", reason: "ambiguous" };
  }
  if (mapping.accountKind === "dedicated_ozon") {
    return { kind: "confirmed" };
  }
  if (hasExactInn(payment.rawText, OZON_PAYER_INN)) {
    return { kind: "confirmed" };
  }
  if (/\b(?:wildberries|wb)\b|вайлдберриз/i.test(payment.rawText)) {
    return { kind: "ignored" };
  }
  return { kind: "unresolved", reason: "ambiguous" };
}
