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
    reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
    status: row.status,
    matchedTransferId: row.matched_transfer_id,
    managerQuestion: row.manager_question,
    managerAnswer: row.manager_answer,
  };
}

export async function saveBankReviewBatch(
  statement: BankStatement,
  suggestions: BankSuggestion[],
  sourceFileName: string,
): Promise<number> {
  const result = await api<{ queued: number }>("/api/opiu/bank-review", {
    method: "POST",
    body: JSON.stringify({
      action: "batch",
      statement: {
        documentHash: statement.documentHash,
        accountNumber: statement.accountNumber,
        ownerInn: statement.ownerInn,
      },
      suggestions,
      sourceFileName,
    }),
  });
  return result.queued;
}

export async function loadBankReviewItems(): Promise<BankReviewItem[]> {
  const result = await api<{ items: ReviewRow[] }>("/api/opiu/bank-review");
  return result.items.map(mapRow);
}

export async function updateBankReviewItem(
  id: string,
  patch: Partial<Pick<BankReviewItem, "companyId" | "accountId" | "category" | "counterparty" | "status" | "managerQuestion" | "managerAnswer">>,
) {
  await api<{ ok: true }>("/api/opiu/bank-review", {
    method: "PATCH",
    body: JSON.stringify({ action: "update", id, patch }),
  });
}

export async function markReviewItems(ids: string[], status: "approved" | "rejected") {
  await api<{ ok: true }>("/api/opiu/bank-review", {
    method: "PATCH",
    body: JSON.stringify({ action: "mark", ids, status }),
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
