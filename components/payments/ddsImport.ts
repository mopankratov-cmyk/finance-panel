// Загрузка распознанного ДДС в базу с защитой от дублей. Три категории:
//  • точные дубли (дата+сумма+статья+кошелёк+название уже есть) — пропускаются молча;
//  • «под вопросом» (совпали дата+сумма+кошелёк, но не точь-в-точь) — спрашиваем у пользователя;
//  • остальные — точно новые.
// Счета сверяются по названию. Пишем напрямую через supabase-клиент пачками.

import { supabase } from "@/lib/supabase";
import type { Account, Payment } from "@/lib/types";
import type { DdsParseResult } from "./ddsCsv";

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
  newAccounts: number;
  reusedAccounts: number;
  duplicatePayments: number; // точные дубли — пропущены
}

export interface ExistingData {
  accounts: Account[];
  payments: Payment[];
}

function guessType(name: string): string {
  return /налич/i.test(name) ? "cash" : "bank";
}

function guessCurrency(name: string): string {
  return /usdt|usd/i.test(name) ? "USD" : "RUB";
}

const exactKey = (date: string, amount: number, category: string, wallet: string, name: string) =>
  `${date}|${amount}|${category}|${wallet}|${name}`;
const looseKey = (date: string, amount: number, wallet: string) => `${date}|${amount}|${wallet}`;

// Строит план вставки против переданного снимка базы (без записи).
export function buildImportPlan(result: DdsParseResult, existing: ExistingData): ImportPlan {
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
  const looseMatch = new Map<string, { date: string; amount: number; wallet: string; category: string; name: string }>();
  for (const p of existing.payments) {
    const wallet = accNameById.get(p.accountId) ?? "";
    const ek = exactKey(p.date, p.amount, p.category, wallet, p.name);
    exactRemaining.set(ek, (exactRemaining.get(ek) ?? 0) + 1);
    const lk = looseKey(p.date, p.amount, wallet);
    if (!looseMatch.has(lk))
      looseMatch.set(lk, { date: p.date, amount: p.amount, wallet, category: p.category, name: p.name });
  }

  const newPaymentRows: PaymentRow[] = [];
  const suspectedRows: SuspectedRow[] = [];
  let duplicatePayments = 0;

  for (const d of result.drafts) {
    const ek = exactKey(d.date, d.amount, d.category, d.wallet, d.name);
    const rem = exactRemaining.get(ek) ?? 0;
    if (rem > 0) {
      exactRemaining.set(ek, rem - 1); // точный дубль — пропускаем
      duplicatePayments++;
      continue;
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
    };
    const match = looseMatch.get(looseKey(d.date, d.amount, d.wallet));
    if (match) suspectedRows.push({ row, match, wallet: d.wallet });
    else newPaymentRows.push(row);
  }

  return {
    accountRows,
    newPaymentRows,
    suspectedRows,
    newAccounts: accountRows.length,
    reusedAccounts: idByWallet.size - accountRows.length,
    duplicatePayments,
  };
}

// Свежий снимок базы — чтобы проверка работала даже при повторном импорте без перезагрузки.
async function fetchExisting(): Promise<ExistingData> {
  const [accRes, payRes] = await Promise.all([
    supabase.from("accounts").select("id,name"),
    supabase.from("payments").select("name,amount,category,account_id,date"),
  ]);
  if (accRes.error) throw new Error(`Не удалось прочитать счета: ${accRes.error.message}`);
  if (payRes.error) throw new Error(`Не удалось прочитать платежи: ${payRes.error.message}`);

  const accounts = (accRes.data ?? []).map(
    (a: { id: string; name: string }) =>
      ({ id: a.id, name: a.name, type: "bank", currency: "RUB", balance: 0 }) as Account,
  );
  const payments = (payRes.data ?? []).map(
    (p: { name: string; amount: number; category: string; account_id: string; date: string }) =>
      ({
        id: "",
        name: p.name,
        amount: Number(p.amount),
        category: p.category,
        accountId: p.account_id,
        date: p.date,
        status: "done",
        counterparty: "",
      }) as Payment,
  );
  return { accounts, payments };
}

// Готовит план против СВЕЖИХ данных базы (для шага загрузки/проверки).
export async function planImport(result: DdsParseResult): Promise<ImportPlan> {
  return buildImportPlan(result, await fetchExisting());
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

// Вставляет счета + точно новые платежи + выбранные пользователем «под вопросом».
export async function commitImport(
  plan: ImportPlan,
  acceptedSuspectedIds: Set<string>,
): Promise<{ accountsCreated: number; paymentsCreated: number; duplicatesSkipped: number; suspectedSkipped: number }> {
  const accepted = plan.suspectedRows.filter((s) => acceptedSuspectedIds.has(s.row.id)).map((s) => s.row);
  const payments = [...plan.newPaymentRows, ...accepted];

  const accountsCreated = await insertChunked("accounts", plan.accountRows, 100);
  const paymentsCreated = await insertChunked("payments", payments, 500);
  return {
    accountsCreated,
    paymentsCreated,
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
