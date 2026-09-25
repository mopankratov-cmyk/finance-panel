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

export type LegacyBankOperation = {
  id: string;
  externalId: string;
  date: string;
  amount: number;
  counterparty: string;
  purpose: string;
  bankAccountNumber?: string;
  counterpartyInn?: string;
  counterpartyAccount?: string;
};

const externalRowNumber = (value: string) => value.match(/:(\d+)$/)?.[1] ?? "";

/**
 * Finds an operation imported before account-based identities existed.
 * The fallback is deliberately strict: date, amount and counterparty must
 * match, while a changed purpose is accepted only for the same source row.
 */
export function uniqueLegacyBankOperationMatch(
  incoming: LegacyBankOperation,
  candidates: LegacyBankOperation[],
): LegacyBankOperation | null {
  const incomingCounterparty = normalize(incoming.counterparty);
  const incomingPurpose = normalize(incoming.purpose);
  const incomingRow = externalRowNumber(incoming.externalId);
  const incomingBankAccount = (incoming.bankAccountNumber ?? "").replace(/\D/g, "");
  const incomingInn = (incoming.counterpartyInn ?? "").replace(/\D/g, "");
  const incomingAccount = (incoming.counterpartyAccount ?? "").replace(/\D/g, "");
  if (!incomingPurpose) return null;

  const matches = candidates.filter((candidate) => {
    if (candidate.date !== incoming.date || Number(candidate.amount).toFixed(2) !== Number(incoming.amount).toFixed(2)) return false;
    const candidateBankAccount = (candidate.bankAccountNumber ?? "").replace(/\D/g, "");
    if (incomingBankAccount && candidateBankAccount && incomingBankAccount !== candidateBankAccount) return false;
    const candidateInn = (candidate.counterpartyInn ?? "").replace(/\D/g, "");
    const candidateAccount = (candidate.counterpartyAccount ?? "").replace(/\D/g, "");
    const stableCounterpartyMatch = Boolean(
      (incomingAccount && candidateAccount && incomingAccount === candidateAccount)
      || (incomingInn && candidateInn && incomingInn === candidateInn),
    );
    if (!stableCounterpartyMatch && (!incomingCounterparty || normalize(candidate.counterparty) !== incomingCounterparty)) return false;
    const candidatePurpose = normalize(candidate.purpose);
    if (candidatePurpose === incomingPurpose) return true;
    const candidateRow = externalRowNumber(candidate.externalId);
    return Boolean(incomingRow && candidateRow === incomingRow && candidatePurpose
      && (incomingPurpose.includes(candidatePurpose) || candidatePurpose.includes(incomingPurpose)));
  });
  return matches.length === 1 ? matches[0] : null;
}
