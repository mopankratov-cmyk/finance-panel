import type { BankStatement } from "./bankStatementGrid";
import type { BankReviewItem } from "@/components/payments/bankReviewStore";
import type { BankSuggestion } from "@/components/payments/bankAutoClassify";
import { BANK_OPERATION_IDENTITY_MARKER, operationIdentityFromReasons } from "@/lib/opiu/bankOperationIdentity";

export function bankLedgerProjectionPayload(
  statement: BankStatement,
  sourceFileName: string,
  suggestions: BankSuggestion[],
  stored: Array<Pick<BankReviewItem, "id" | "externalId" | "date" | "amount" | "purpose" | "counterparty" | "counterpartyInn" | "reasons">>,
) {
  const sourceByExternalId = new Map(suggestions.map((suggestion) => [suggestion.row.id, suggestion.row]));
  return {
    statement: {
      documentHash: statement.documentHash,
      bank: statement.bank,
      sourceFileName,
      owner: statement.owner,
      ownerInn: statement.ownerInn,
      accountNumber: statement.accountNumber,
      dateFrom: statement.dateFrom,
      dateTo: statement.dateTo,
      openingBalance: statement.openingBalance,
      closingBalance: statement.closingBalance,
      declaredDebit: statement.declaredDebit,
      declaredCredit: statement.declaredCredit,
      operationCount: statement.rows.length,
    },
    transactions: stored.map((item) => {
      const source = sourceByExternalId.get(item.externalId);
      const identityMarker = operationIdentityFromReasons(item.reasons);
      return {
        reviewItemId: item.id,
        externalId: item.externalId,
        operationIdentity: identityMarker?.slice(BANK_OPERATION_IDENTITY_MARKER.length) ?? "",
        date: item.date,
        amount: item.amount,
        documentNumber: source?.documentNumber ?? "",
        purpose: source?.purpose ?? item.purpose,
        counterparty: source?.counterparty ?? item.counterparty,
        counterpartyInn: source?.counterpartyInn ?? item.counterpartyInn,
        counterpartyAccount: source?.counterpartyAccount ?? "",
      };
    }),
  };
}
