import type { BankStatement } from "./bankStatement";
import type { BankSuggestion } from "./bankAutoClassify";
import { supabase } from "@/lib/supabase";

export type ReviewStatus = "ready" | "needs_info" | "waiting_manager" | "approved" | "rejected";

export interface BankReviewItem {
  id: string;
  batchId: string;
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

function setupError(message: string) {
  return message.includes("bank_review_items")
    ? "Очередь банковских операций ещё не подключена владельцем. Передайте ему подготовленный SQL."
    : message;
}

async function connectTransferPairs() {
  const [{ data: items, error: itemsError }, { data: companies, error: companiesError }] = await Promise.all([
    supabase
      .from("bank_review_items")
      .select("id,date,amount,company_id,matched_transfer_id,reasons")
      .in("status", ["ready", "needs_info", "waiting_manager"])
      .is("matched_transfer_id", null),
    supabase.from("companies").select("id,group_name"),
  ]);
  if (itemsError) throw new Error(setupError(itemsError.message));
  if (companiesError) throw new Error(companiesError.message);

  const groupByCompany = new Map((companies ?? []).map((company) => [company.id, company.group_name]));
  const used = new Set<string>();
  const rows = items ?? [];

  for (const outgoing of rows) {
    if (used.has(outgoing.id) || Number(outgoing.amount) >= 0) continue;
    const outgoingTime = new Date(`${outgoing.date}T00:00:00`).getTime();
    const incoming = rows.find((candidate) => {
      if (used.has(candidate.id) || candidate.id === outgoing.id || Number(candidate.amount) <= 0) return false;
      if (Math.abs(Number(candidate.amount) + Number(outgoing.amount)) > 0.005) return false;
      const candidateTime = new Date(`${candidate.date}T00:00:00`).getTime();
      return Math.abs(candidateTime - outgoingTime) <= 2 * 24 * 60 * 60 * 1000;
    });
    if (!incoming) continue;

    used.add(outgoing.id);
    used.add(incoming.id);
    const sameGroup =
      outgoing.company_id &&
      incoming.company_id &&
      groupByCompany.get(outgoing.company_id) === groupByCompany.get(incoming.company_id);
    const outgoingCategory = sameGroup ? "Выбытие — Перевод между счетами" : "Выдача кредитов и займов";
    const incomingCategory = sameGroup ? "Поступление — Перевод между счетами" : "Получение кредитов и займов";
    const reason = sameGroup
      ? "Найдена парная операция между счетами одной группы"
      : "Найдена парная операция между разными группами — предварительно займ";

    const { error: outgoingError } = await supabase
      .from("bank_review_items")
      .update({
        matched_transfer_id: incoming.id,
        category: outgoingCategory,
        reasons: [...(Array.isArray(outgoing.reasons) ? outgoing.reasons : []), reason],
      })
      .eq("id", outgoing.id);
    if (outgoingError) throw new Error(setupError(outgoingError.message));

    const { error: incomingError } = await supabase
      .from("bank_review_items")
      .update({
        matched_transfer_id: outgoing.id,
        category: incomingCategory,
        reasons: [...(Array.isArray(incoming.reasons) ? incoming.reasons : []), reason],
      })
      .eq("id", incoming.id);
    if (incomingError) throw new Error(setupError(incomingError.message));
  }
}

export async function saveBankReviewBatch(
  statement: BankStatement,
  suggestions: BankSuggestion[],
  sourceFileName: string,
): Promise<number> {
  const batchId = crypto.randomUUID();
  const rows = suggestions.map((suggestion) => ({
    id: crypto.randomUUID(),
    batch_id: batchId,
    source_file_name: sourceFileName,
    external_id: suggestion.row.id,
    date: suggestion.row.date,
    amount: suggestion.row.amount,
    bank_account_number: statement.accountNumber,
    owner_inn: statement.ownerInn,
    company_id: suggestion.companyId,
    account_id: suggestion.accountId,
    counterparty: suggestion.row.counterparty,
    counterparty_inn: suggestion.row.counterpartyInn,
    purpose: suggestion.row.purpose,
    category: suggestion.category,
    confidence: suggestion.confidence,
    reasons: suggestion.reasons,
    status: suggestion.needsReview ? "needs_info" : "ready",
    matched_transfer_id: suggestion.transferCandidateId,
  }));
  const { error } = await supabase
    .from("bank_review_items")
    .upsert(rows, { onConflict: "bank_account_number,external_id", ignoreDuplicates: true });
  if (error) throw new Error(setupError(error.message));
  await connectTransferPairs();
  return rows.length;
}

export async function loadBankReviewItems(): Promise<BankReviewItem[]> {
  const { data, error } = await supabase
    .from("bank_review_items")
    .select("*")
    .in("status", ["ready", "needs_info", "waiting_manager"])
    .order("date", { ascending: false });
  if (error) throw new Error(setupError(error.message));
  return (data ?? []).map((row) => ({
    id: row.id,
    batchId: row.batch_id,
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
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    status: row.status,
    matchedTransferId: row.matched_transfer_id,
    managerQuestion: row.manager_question,
    managerAnswer: row.manager_answer,
  }));
}

export async function updateBankReviewItem(
  id: string,
  patch: Partial<Pick<BankReviewItem, "companyId" | "accountId" | "category" | "counterparty" | "status" | "managerQuestion" | "managerAnswer">>,
) {
  const row: Record<string, unknown> = {};
  if ("companyId" in patch) row.company_id = patch.companyId;
  if ("accountId" in patch) row.account_id = patch.accountId;
  if ("category" in patch) row.category = patch.category;
  if ("counterparty" in patch) row.counterparty = patch.counterparty;
  if ("status" in patch) row.status = patch.status;
  if ("managerQuestion" in patch) row.manager_question = patch.managerQuestion;
  if ("managerAnswer" in patch) row.manager_answer = patch.managerAnswer;
  const { error } = await supabase.from("bank_review_items").update(row).eq("id", id);
  if (error) throw new Error(setupError(error.message));
}

export async function markReviewItems(ids: string[], status: "approved" | "rejected") {
  const { error } = await supabase.from("bank_review_items").update({ status }).in("id", ids);
  if (error) throw new Error(setupError(error.message));
}

export async function rememberBankAccount(
  bankAccountNumber: string,
  ownerInn: string,
  companyId: string,
  accountId: string,
) {
  const { error } = await supabase.from("bank_account_mappings").upsert(
    { bank_account_number: bankAccountNumber, owner_inn: ownerInn, company_id: companyId, account_id: accountId },
    { onConflict: "bank_account_number" },
  );
  if (error) throw new Error(setupError(error.message));
}
