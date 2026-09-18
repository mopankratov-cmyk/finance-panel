import { createHash } from "node:crypto";

export const BANK_OPERATION_IDENTITY_MARKER = "__operation_identity:";

const normalize = (value: string) => value
  .toLowerCase()
  .replace(/ё/g, "е")
  .replace(/[^а-яa-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export function bankOperationIdentity(row: {
  bankAccountNumber: string;
  date: string;
  amount: number;
  documentNumber?: string;
  counterpartyAccount?: string;
  counterpartyInn?: string;
  counterparty?: string;
}): string | null {
  const bankAccountNumber = row.bankAccountNumber.replace(/\D/g, "");
  const documentNumber = normalize(row.documentNumber ?? "");
  if (!bankAccountNumber || !documentNumber || !row.date || !Number.isFinite(row.amount)) return null;

  const counterpartyAccount = (row.counterpartyAccount ?? "").replace(/\D/g, "");
  const counterpartyInn = (row.counterpartyInn ?? "").replace(/\D/g, "");
  const counterparty = counterpartyAccount || counterpartyInn ? "" : normalize(row.counterparty ?? "");
  const fingerprint = JSON.stringify([
    bankAccountNumber,
    row.date,
    row.amount.toFixed(2),
    documentNumber,
    counterpartyAccount,
    counterpartyInn,
    counterparty,
  ]);
  return BANK_OPERATION_IDENTITY_MARKER + createHash("sha256").update(fingerprint).digest("hex");
}

export function operationIdentityFromReasons(reasons: unknown): string | null {
  if (!Array.isArray(reasons)) return null;
  return reasons.map(String).find((reason) => reason.startsWith(BANK_OPERATION_IDENTITY_MARKER)) ?? null;
}
