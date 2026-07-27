// Загрузка распознанного ДДС в базу с защитой от дублей. Три категории:
//  • точные дубли (дата+сумма+статья+кошелёк+название уже есть) — пропускаются молча;
//  • «под вопросом» (совпали дата+сумма+кошелёк, но не точь-в-точь) — спрашиваем у пользователя;
//  • остальные — точно новые.
// Счета сверяются по названию. Пишем напрямую через supabase-клиент пачками.

import { supabase } from "@/lib/supabase";
import type { Account, Payment } from "@/lib/types";
import type { DdsParseResult } from "./ddsCsv";
import type { DdsCompany } from "./ddsCompanies";

type AccountRow = { id: string; name: string; type: string; currency: string; balance: number };
type PaymentRow = {
  id: string;
  name: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  account_id: string;
  date: string;
  status: string;
  counterparty: string;
  comment: string | null;
  company_id: string | null;
  import_source: string | null;
};

export interface SuspectedRow {
  row: PaymentRow;
  // на что похоже из уже имеющегося — показываем пользователю
  match: { date: string; amount: number; wallet: string; category: string; name: string };
  wallet: string; // кошелёк нового платежа
}

export interface ImportPlan {
  accountRows: AccountRow[];
  newPaymentRows: PaymentRow[]; // точно новые — добавляются всегда
  suspectedRows: SuspectedRow[]; // совпали дата+сумма+кошелёк — спросить
  companyUpdates: Array<{ paymentId: string; companyId: string }>;
  newAccounts: number;
  reusedAccounts: number;
  duplicatePayments: number; // точные дубли — пропущены
}

export interface ExistingData {
  accounts: Account[];
  payments: Array<Payment & { companyId?: string | null }>;
}

export interface CompanyAssignment {
  companies: DdsCompany[];
  // undefined = брать компанию из колонки файла; null = оставить без компании; id = назначить всему файлу
  overrideCompanyId?: string | null;
}

function guessType(name: string): string {
  return /налич/i.test(name) ? "cash" : "bank";
}

function guessCurrency(name: string): string {
  return /usdt|usd/i.test(name) ? "USD" : "RUB";
}

const exactKey = (
  date: string,
  amount: number,
  category: string,
  wallet: string,
  name: string,
  companyId: string | null,
) => `${date}|${amount}|${category}|${wallet}|${name}|${companyId ?? ""}`;
const baseExactKey = (date: string, amount: number, category: string, wallet: string, name: string) =>
  `${date}|${amount}|${category}|${wallet}|${name}`;
const looseKey = (date: string, amount: number, wallet: string) => `${date}|${amount}|${wallet}`;

function companyIdForDraft(
  companyName: string,
  assignment: CompanyAssignment,
): string | null {
  if (assignment.overrideCompanyId !== undefined) return assignment.overrideCompanyId;
  if (companyName === "Группа (общее)") return null;
  return assignment.companies.find((company) => company.name === companyName)?.id ?? null;
}

// Строит план вставки против переданного снимка базы (без записи).
export function buildImportPlan(
  result: DdsParseResult,
  existing: ExistingData,
  assignment: CompanyAssignment,
): ImportPlan {
  // --- Счета: переиспользуем существующие по названию ---
  const idByName = new Map(existing.accounts.map((a) => [a.name, a.id] as const));
  const idByWallet = new Map<string, string>();
  const accountRows: AccountRow[] = [];

  const ensureAccount = (name: string) => {
    if (idByWallet.has(name)) return;
    const existingId = idByName.get(name);
    if (existingId) {
      idByWallet.set(name, existingId);
      return;
    }
    const id = crypto.randomUUID();
    idByWallet.set(name, id);
    accountRows.push({ id, name, type: guessType(name), currency: guessCurrency(name), balance: 0 });
  };
  for (const name of result.walletDirectory) ensureAccount(name);
  for (const d of result.drafts) ensureAccount(d.wallet);

  // --- Индексы по уже имеющимся платежам ---
  const accNameById = new Map(existing.accounts.map((a) => [a.id, a.name] as const));
  const exactRemaining = new Map<string, number>();
  const unassignedExact = new Map<string, string[]>();
  const looseMatch = new Map<string, { date: string; amount: number; wallet: string; category: string; name: string }>();
  for (const p of existing.payments) {
    const wallet = accNameById.get(p.accountId) ?? "";
    const ek = exactKey(p.date, p.amount, p.category, wallet, p.name, p.companyId ?? null);
    exactRemaining.set(ek, (exactRemaining.get(ek) ?? 0) + 1);
    if (!p.companyId && p.id) {
      const bk = baseExactKey(p.date, p.amount, p.category, wallet, p.name);
      const ids = unassignedExact.get(bk) ?? [];
      ids.push(p.id);
      unassignedExact.set(bk, ids);
    }
    const lk = looseKey(p.date, p.amount, wallet);
    if (!looseMatch.has(lk))
      looseMatch.set(lk, { date: p.date, amount: p.amount, wallet, category: p.category, name: p.name });
  }

  const newPaymentRows: PaymentRow[] = [];
  const suspectedRows: SuspectedRow[] = [];
  const companyUpdates: Array<{ paymentId: string; companyId: string }> = [];
  let duplicatePayments = 0;

  for (const d of result.drafts) {
    const companyId = companyIdForDraft(d.company, assignment);
    const ek = exactKey(d.date, d.amount, d.category, d.wallet, d.name, companyId);
    const rem = exactRemaining.get(ek) ?? 0;
    if (rem > 0) {
      exactRemaining.set(ek, rem - 1); // точный дубль — пропускаем
      duplicatePayments++;
      continue;
    }
    if (companyId) {
      const bk = baseExactKey(d.date, d.amount, d.category, d.wallet, d.name);
      const unassignedIds = unassignedExact.get(bk);
      const paymentId = unassignedIds?.shift();
      if (paymentId) {
        companyUpdates.push({ paymentId, companyId });
        continue;
      }
    }
    const row: PaymentRow = {
      id: crypto.randomUUID(),
      name: d.name,
      amount: d.amount,
      type: d.amount >= 0 ? "income" : "expense",
      category: d.category,
      account_id: idByWallet.get(d.wallet) ?? "",
      date: d.date,
      status: "done",
      counterparty: d.counterparty,
      comment: null, // «Направление бизнеса» появится отдельным полем на Этапе 2
      company_id: companyId,
      import_source: d.importSource ?? null,
    };
    const match = looseMatch.get(looseKey(d.date, d.amount, d.wallet));
    if (match) suspectedRows.push({ row, match, wallet: d.wallet });
    else newPaymentRows.push(row);
  }

  return {
    accountRows,
    newPaymentRows,
    suspectedRows,
    companyUpdates,
    newAccounts: accountRows.length,
    reusedAccounts: idByWallet.size - accountRows.length,
    duplicatePayments,
  };
}

// Свежий снимок базы — чтобы проверка работала даже при повторном импорте без перезагрузки.
async function fetchExisting(): Promise<ExistingData> {
  const accRes = await supabase.from("accounts").select("id,name");
  if (accRes.error) throw new Error(`Не удалось прочитать счета: ${accRes.error.message}`);

  const accounts = (accRes.data ?? []).map(
    (a: { id: string; name: string }) =>
      ({ id: a.id, name: a.name, type: "bank", currency: "RUB", balance: 0 }) as Account,
  );
  const payments: Array<Payment & { companyId?: string | null }> = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const payRes = await supabase
      .from("payments")
      .select("id,name,amount,category,account_id,date,company_id")
      .range(from, from + pageSize - 1);
    if (payRes.error) throw new Error(`Не удалось прочитать платежи: ${payRes.error.message}`);
    const page = (payRes.data ?? []).map(
      (p) =>
        ({
          id: p.id,
          name: p.name,
          amount: Number(p.amount),
          category: p.category,
          accountId: p.account_id,
          date: p.date,
          status: "done",
          counterparty: "",
          companyId: p.company_id,
        }) as Payment & { companyId?: string | null },
    );
    payments.push(...page);
    if (page.length < pageSize) break;
  }
  return { accounts, payments };
}

// Готовит план против СВЕЖИХ данных базы (для шага загрузки/проверки).
export async function planImport(
  result: DdsParseResult,
  assignment: CompanyAssignment,
): Promise<ImportPlan> {
  return buildImportPlan(result, await fetchExisting(), assignment);
}

async function insertChunked(table: string, rows: object[], size: number): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await supabase.from(table).insert(chunk as never);
    if (error) {
      throw new Error(
        `Ошибка при вставке в «${table}» (строки ${i + 1}–${i + chunk.length}): ${error.message}`,
      );
    }
    inserted += chunk.length;
  }
  return inserted;
}

async function upsertPaymentsChunked(rows: PaymentRow[], size: number): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { data, error } = await supabase
      .from("payments")
      .upsert(chunk, { onConflict: "import_source", ignoreDuplicates: true })
      .select("id");
    if (error) {
      throw new Error(
        `Ошибка при вставке в «payments» (строки ${i + 1}–${i + chunk.length}): ${error.message}`,
      );
    }
    inserted += data?.length ?? 0;
  }
  return inserted;
}

// Вставляет счета + точно новые платежи + выбранные пользователем «под вопросом».
export async function commitImport(
  plan: ImportPlan,
  acceptedSuspectedIds: Set<string>,
): Promise<{
  accountsCreated: number;
  paymentsCreated: number;
  companiesAssigned: number;
  duplicatesSkipped: number;
  suspectedSkipped: number;
}> {
  const accepted = plan.suspectedRows.filter((s) => acceptedSuspectedIds.has(s.row.id)).map((s) => s.row);
  const payments = [...plan.newPaymentRows, ...accepted];

  const accountsCreated = await insertChunked("accounts", plan.accountRows, 100);
  for (let i = 0; i < plan.companyUpdates.length; i += 100) {
    const chunk = plan.companyUpdates.slice(i, i + 100);
    const byCompany = new Map<string, string[]>();
    for (const update of chunk) {
      const ids = byCompany.get(update.companyId) ?? [];
      ids.push(update.paymentId);
      byCompany.set(update.companyId, ids);
    }
    for (const [companyId, ids] of byCompany) {
      const { error } = await supabase.from("payments").update({ company_id: companyId }).in("id", ids);
      if (error) throw new Error(`Не удалось назначить компанию платежам: ${error.message}`);
    }
  }
  const paymentsCreated = await upsertPaymentsChunked(payments, 500);
  return {
    accountsCreated,
    paymentsCreated,
    companiesAssigned: plan.companyUpdates.length,
    duplicatesSkipped: plan.duplicatePayments,
    suspectedSkipped: plan.suspectedRows.length - accepted.length,
  };
}

// Стартовые демо-счета (из DEFAULT_ACCOUNTS) — удаляем их и связанные платежи.
const DEMO_ACCOUNT_NAMES = ["WB Счёт 1", "WB Счёт 2", "Ozon", "Банковский счёт", "Наличные"];

export async function cleanDemoData(): Promise<{ accountsDeleted: number; paymentsDeleted: number }> {
  const { data: accs, error } = await supabase
    .from("accounts")
    .select("id")
    .in("name", DEMO_ACCOUNT_NAMES);
  if (error) throw new Error(`Не удалось найти демо-счета: ${error.message}`);

  const ids = (accs ?? []).map((a: { id: string }) => a.id);
  if (ids.length === 0) return { accountsDeleted: 0, paymentsDeleted: 0 };

  const { data: pays } = await supabase.from("payments").select("id").in("account_id", ids);
  const paymentsDeleted = pays?.length ?? 0;

  const { error: pe } = await supabase.from("payments").delete().in("account_id", ids);
  if (pe) throw new Error(`Не удалось удалить демо-платежи: ${pe.message}`);

  const { error: ae } = await supabase.from("accounts").delete().in("id", ids);
  if (ae) throw new Error(`Не удалось удалить демо-счета: ${ae.message}`);

  return { accountsDeleted: ids.length, paymentsDeleted };
}
