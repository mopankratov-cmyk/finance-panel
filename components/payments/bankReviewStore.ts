import type { BankStatement } from "./bankStatement";
import type { BankAccountMapping, BankSuggestion } from "./bankAutoClassify";

export type ReviewStatus = "ready" | "needs_info" | "waiting_manager" | "approved" | "rejected";

export interface BankReviewItem {
  id: string;
  batchId: string;
  documentHash: string;
  sourceFileName: string;
  externalId: string;
  date: string;
  amount: number;
  bankAccountNumber: string;
  ownerInn: string;
  companyId: string | null;
  accountId: string | null;
  counterparty: string;
  counterpartyInn: string;
  purpose: string;
  category: string | null;
  confidence: number;
  reasons: string[];
  status: ReviewStatus;
  matchedTransferId: string | null;
  managerQuestion: string | null;
  managerAnswer: string | null;
  paymentComment?: string;
}

type ReviewRow = {
  id: string;
  batch_id: string;
  document_hash: string;
  source_file_name: string;
  external_id: string;
  date: string;
  amount: number | string;
  bank_account_number: string;
  owner_inn: string;
  company_id: string | null;
  account_id: string | null;
  counterparty: string;
  counterparty_inn: string;
  purpose: string;
  category: string | null;
  confidence: number | string;
  reasons: unknown;
  status: ReviewStatus;
  matched_transfer_id: string | null;
  manager_question: string | null;
  manager_answer: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error || `Ошибка банковской очереди ${response.status}`);
  if (!payload) throw new Error("Банковская очередь вернула пустой ответ");
  return payload;
}

function mapRow(row: ReviewRow): BankReviewItem {
  const reasons = Array.isArray(row.reasons) ? row.reasons.map(String) : [];
  return {
    id: row.id,
    batchId: row.batch_id,
    documentHash: row.document_hash,
    sourceFileName: row.source_file_name,
    externalId: row.external_id,
    date: row.date,
    amount: Number(row.amount),
    bankAccountNumber: row.bank_account_number,
    ownerInn: row.owner_inn,
    companyId: row.company_id,
    accountId: row.account_id,
    counterparty: row.counterparty,
    counterpartyInn: row.counterparty_inn,
    purpose: row.purpose,
    category: row.category,
    confidence: Number(row.confidence),
    reasons,
    status: row.status,
    matchedTransferId: row.matched_transfer_id,
    managerQuestion: row.manager_question,
    managerAnswer: row.manager_answer,
    paymentComment: reasons.find((reason) => reason.startsWith("__payment_comment:"))?.slice("__payment_comment:".length) ?? "",
  };
}

export async function saveBankReviewBatch(
  statement: BankStatement,
  suggestions: BankSuggestion[],
  sourceFileName: string,
): Promise<{queued:number;approved:number;matchedTransfers:number;duplicatesSkipped:number}> {
  const result = await api<{ queued: number; approved?: number; matchedTransfers?: number; duplicatesSkipped?: number }>("/api/opiu/bank-review", {
    method: "POST",
    body: JSON.stringify({
      action: "batch",
      statement: {
        documentHash: statement.documentHash,
        bank: statement.bank,
        owner: statement.owner,
        accountNumber: statement.accountNumber,
        ownerInn: statement.ownerInn,
        dateFrom: statement.dateFrom,
        dateTo: statement.dateTo,
        openingBalance: statement.openingBalance,
        closingBalance: statement.closingBalance,
        declaredDebit: statement.declaredDebit,
        declaredCredit: statement.declaredCredit,
      },
      suggestions,
      sourceFileName,
    }),
  });
  return {queued:result.queued,approved:result.approved ?? 0,matchedTransfers:result.matchedTransfers ?? 0,duplicatesSkipped:result.duplicatesSkipped ?? 0};
}

export async function loadBankReviewItems(): Promise<BankReviewItem[]> {
  const result = await api<{ items: ReviewRow[] }>("/api/opiu/bank-review");
  return result.items.map(mapRow);
}

export type BankLedgerControl = {
  reviewCount: number;
  reviewAmount: number;
  transactionCount: number;
  transactionAmount: number;
  sourceCountDifference: number;
  sourceAmountDifference: number;
  unprojectedCount: number;
  statementMismatchCount: number;
  approvedCount: number;
  allocationCount: number;
  missingApprovedCount: number;
  mismatchCount: number;
  mismatchAmount: number;
};

export async function loadBankLedgerControl(): Promise<BankLedgerControl | null> {
  const result = await api<{ available: boolean; control?: Partial<BankLedgerControl> }>("/api/opiu/bank-review?resource=ledger-control");
  if (!result.available || !result.control) return null;
  const number = (key: keyof BankLedgerControl) => Number(result.control?.[key] ?? 0);
  return {
    reviewCount: number("reviewCount"), reviewAmount: number("reviewAmount"),
    transactionCount: number("transactionCount"), transactionAmount: number("transactionAmount"),
    sourceCountDifference: number("sourceCountDifference"), sourceAmountDifference: number("sourceAmountDifference"),
    unprojectedCount: number("unprojectedCount"), statementMismatchCount: number("statementMismatchCount"),
    approvedCount: number("approvedCount"), allocationCount: number("allocationCount"),
    missingApprovedCount: number("missingApprovedCount"), mismatchCount: number("mismatchCount"),
    mismatchAmount: number("mismatchAmount"),
  };
}

export async function loadBankGoogleSyncData(): Promise<{
  items: BankReviewItem[];
  sourceByPaymentId: Map<string, string>;
}> {
  const result = await api<{
    items: ReviewRow[];
    payment_sources: Array<{ id: string; import_source: string | null }>;
  }>("/api/opiu/bank-review?resource=google-sync");
  return {
    items: result.items.map(mapRow),
    sourceByPaymentId: new Map(result.payment_sources
      .filter((row): row is { id: string; import_source: string } => Boolean(row.import_source))
      .map((row) => [row.id, row.import_source])),
  };
}

export async function updateBankReviewItem(
  id: string,
  patch: Partial<Pick<BankReviewItem, "companyId" | "accountId" | "category" | "counterparty" | "status" | "managerQuestion" | "managerAnswer" | "paymentComment">>,
) {
  await api<{ ok: true }>("/api/opiu/bank-review", {
    method: "PATCH",
    body: JSON.stringify({ action: "update", id, patch }),
  });
}

export async function askManagerAboutBankReviewItem(id: string, question: string) {
  await api<{ ok: true }>("/api/opiu/bank-review", {
    method: "PATCH",
    body: JSON.stringify({ action: "ask_manager", id, question }),
  });
}

export async function markReviewItems(ids: string[], status: "approved" | "rejected") {
  await api<{ ok: true }>("/api/opiu/bank-review", {
    method: "PATCH",
    body: JSON.stringify({ action: "mark", ids, status }),
  });
}

export async function clearBankImport(): Promise<{ reviewItemsDeleted: number; paymentsDeleted: number }> {
  return api<{ reviewItemsDeleted: number; paymentsDeleted: number }>("/api/opiu/bank-review", {
    method: "DELETE",
    body: JSON.stringify({ confirm: "CLEAR_BANK_IMPORT" }),
  });
}

export async function rememberBankAccount(
  bankAccountNumber: string,
  ownerInn: string,
  companyId: string,
  accountId: string,
) {
  await api<{ ok: true }>("/api/opiu/bank-review", {
    method: "POST",
    body: JSON.stringify({
      action: "mapping",
      mapping: { bankAccountNumber, ownerInn, companyId, accountId },
    }),
  });
}

export async function loadBankAccountMappings(): Promise<BankAccountMapping[]> {
  const result = await api<{
    mappings: Array<{
      bank_account_number: string;
      owner_inn: string;
      company_id: string;
      account_id: string;
    }>;
  }>("/api/opiu/bank-review?resource=mappings");
  return result.mappings.map((row) => ({
    bankAccountNumber: String(row.bank_account_number ?? "").replace(/\D/g, ""),
    ownerInn: String(row.owner_inn ?? "").replace(/\D/g, ""),
    companyId: row.company_id,
    accountId: row.account_id,
  }));
}
