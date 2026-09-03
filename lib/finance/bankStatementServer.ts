
import { createHash } from "node:crypto";
import { classifyBankStatement, matchInternalTransfers, type BankAccountMapping, type BankSuggestion } from "@/components/payments/bankAutoClassify";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account, Payment } from "@/lib/types";
import { statementFromGrid, type BankStatement } from "./bankStatementGrid";
import { cleanPdf, recognizeBankStatementPdf } from "./bankStatementPdf";
import { xlsxGrid, xlsxText } from "./xlsxGrid";

// Выписку разбирает сервер целиком: файл → операции → предложения по компании,
// кошельку и статье. Раньше XLSX и классификация жили в браузере, и результат
// зависел от того, кто загружает и что у него в памяти вкладки. Теперь одна и
// та же выписка даёт один и тот же результат у любого сотрудника.

export interface UploadedStatement {
  name: string;
  bytes: Buffer;
  mimeType: string;
}

export async function recognizeBankStatementUpload(file: UploadedStatement): Promise<BankStatement> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const documentHash = createHash("sha256").update(file.bytes).digest("hex");
    return statementFromGrid(xlsxGrid(file.bytes), xlsxText(file.bytes), documentHash);
  }
  if (lower.endsWith(".pdf") || file.mimeType === "application/pdf") {
    return recognizeBankStatementPdf(cleanPdf(file.bytes), file.name);
  }
  throw new Error("Поддерживаются банковские выписки XLSX и PDF");
}

type PaymentRow = { id: string; name: string; amount: number; category: string; account_id: string; date: string; status: string; counterparty: string | null; comment: string | null; company_id: string | null };

/** История для «обучения» классификатора — факты за последние 18 месяцев. */
async function loadHistory(db: SupabaseClient): Promise<Array<Payment & { companyId?: string | null }>> {
  const since = new Date();
  since.setMonth(since.getMonth() - 18);
  const rows = await loadAllSupabasePages<PaymentRow>((from, to) => db
    .from("payments")
    .select("id,name,amount,category,account_id,date,status,counterparty,comment,company_id")
    .eq("status", "done")
    .gte("date", since.toISOString().slice(0, 10))
    .order("date", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to), { label: "Выписка: история ДДС для классификации", maxPages: 60 });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    category: row.category,
    accountId: row.account_id,
    date: row.date,
    status: "done" as const,
    counterparty: row.counterparty ?? "",
    comment: row.comment ?? undefined,
    companyId: row.company_id,
  }));
}

export async function suggestForStatement(db: SupabaseClient, statement: BankStatement): Promise<BankSuggestion[]> {
  const [accounts, companies, mappings, history] = await Promise.all([
    db.from("accounts").select("id,name,type,currency,balance"),
    db.from("companies").select("id,name,group_name,is_active"),
    db.from("bank_account_mappings").select("bank_account_number,owner_inn,company_id,account_id"),
    loadHistory(db),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  if (companies.error) throw new Error(companies.error.message);
  if (mappings.error) throw new Error(mappings.error.message);
  const accountList: Account[] = (accounts.data ?? []).map((row) => ({
    id: String(row.id), name: String(row.name), type: row.type as Account["type"], currency: row.currency as Account["currency"], balance: Number(row.balance),
  }));
  const companyList = (companies.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name), groupName: String(row.group_name ?? ""), isActive: Boolean(row.is_active) }));
  const mappingList: BankAccountMapping[] = (mappings.data ?? []).map((row) => ({
    bankAccountNumber: String(row.bank_account_number ?? "").replace(/\D/g, ""),
    ownerInn: String(row.owner_inn ?? "").replace(/\D/g, ""),
    companyId: String(row.company_id),
    accountId: String(row.account_id),
  }));
  return matchInternalTransfers(classifyBankStatement(statement, accountList, companyList, history, mappingList));
}
