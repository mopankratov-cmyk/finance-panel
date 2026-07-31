import "server-only";

import { DEFAULT_STATE } from "@/lib/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { Account, FinanceAction, FinanceState, Loan, Payment } from "@/lib/types";

type Db = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type AccountRow = { id: string; name: string; type: string; currency: string; balance: number; created_at?: string };
type PaymentRow = { id: string; name: string; amount: number; type: string; category: string; account_id: string; date: string; status: string; counterparty: string; comment: string | null; created_at?: string };
type LoanRow = { id: string; creditor: string; principal: number; rate_per_day: number; start_date: string; due_date: string; status: string; created_at?: string };

const accountToRow = (account: Account) => ({
  id: account.id,
  name: account.name,
  type: account.type,
  currency: account.currency,
  balance: account.balance,
});

const paymentToRow = (payment: Payment) => ({
  id: payment.id,
  name: payment.name,
  amount: payment.amount,
  type: payment.amount >= 0 ? "income" : "expense",
  category: payment.category,
  account_id: payment.accountId,
  date: payment.date,
  status: payment.status,
  counterparty: payment.counterparty,
  comment: payment.comment ?? null,
});

const loanToRow = (loan: Loan) => ({
  id: loan.id,
  creditor: loan.creditorName,
  principal: loan.principalAmount,
  rate_per_day: loan.interestRatePerDay,
  start_date: loan.startDate,
  due_date: loan.dueDate,
  status: loan.status,
});

function requireDb(): Db {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  return db;
}

function buildSeedState(): FinanceState {
  const accountIds = new Map<string, string>();
  const accounts = DEFAULT_STATE.accounts.map((account) => {
    const id = crypto.randomUUID();
    accountIds.set(account.id, id);
    return { ...account, id };
  });
  return {
    accounts,
    payments: DEFAULT_STATE.payments.map((payment) => ({
      ...payment,
      id: crypto.randomUUID(),
      accountId: accountIds.get(payment.accountId) ?? payment.accountId,
    })),
    loans: DEFAULT_STATE.loans.map((loan) => ({ ...loan, id: crypto.randomUUID() })),
  };
}

async function seed(db: Db) {
  const state = buildSeedState();
  const accounts = await db.from("accounts").insert(state.accounts.map(accountToRow));
  if (accounts.error) throw accounts.error;
  if (state.payments.length) {
    const payments = await db.from("payments").insert(state.payments.map(paymentToRow));
    if (payments.error) throw payments.error;
  }
  if (state.loans.length) {
    const loans = await db.from("loans").insert(state.loans.map(loanToRow));
    if (loans.error) throw loans.error;
  }
}

export async function loadFinanceStateServer(): Promise<FinanceState> {
  const db = requireDb();
  const [accountsResult, paymentsResult, loansResult] = await Promise.all([
    db.from("accounts").select("*").order("created_at"),
    db.from("payments").select("*").order("date", { ascending: false }),
    db.from("loans").select("*").order("created_at"),
  ]);
  if (accountsResult.error) throw accountsResult.error;
  if (paymentsResult.error) throw paymentsResult.error;
  if (loansResult.error) throw loansResult.error;

  const state: FinanceState = {
    accounts: ((accountsResult.data ?? []) as AccountRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as Account["type"],
      currency: row.currency as Account["currency"],
      balance: Number(row.balance),
    })),
    payments: ((paymentsResult.data ?? []) as PaymentRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      amount: Number(row.amount),
      category: row.category,
      accountId: row.account_id,
      date: row.date,
      status: row.status as Payment["status"],
      counterparty: row.counterparty ?? "",
      comment: row.comment ?? undefined,
    })),
    loans: ((loansResult.data ?? []) as LoanRow[]).map((row) => ({
      id: row.id,
      creditorName: row.creditor,
      principalAmount: Number(row.principal),
      interestRatePerDay: Number(row.rate_per_day),
      startDate: row.start_date,
      dueDate: row.due_date,
      status: row.status as Loan["status"],
    })),
  };
  if (!state.accounts.length && !state.payments.length && !state.loans.length) {
    await seed(db);
    return loadFinanceStateServer();
  }
  return state;
}

export async function persistFinanceActionServer(
  action: FinanceAction,
  prevState: FinanceState,
  nextState: FinanceState,
) {
  const db = requireDb();
  let result: { error: { message: string } | null } | null = null;
  switch (action.type) {
    case "LOAD": return;
    case "ADD_ACCOUNT":
      result = await db.from("accounts").insert(accountToRow(action.payload));
      break;
    case "UPDATE_ACCOUNT":
      result = await db.from("accounts").update(accountToRow(action.payload)).eq("id", action.payload.id);
      break;
    case "DELETE_ACCOUNT":
      result = await db.from("accounts").delete().eq("id", action.payload);
      break;
    case "ADD_PAYMENT":
      result = await db.from("payments").insert(paymentToRow(action.payload));
      break;
    case "UPDATE_PAYMENT":
      result = await db.from("payments").update(paymentToRow(action.payload)).eq("id", action.payload.id);
      break;
    case "DELETE_PAYMENT":
      result = await db.from("payments").delete().eq("id", action.payload);
      break;
    case "MARK_PAYMENT_DONE": {
      const payment = prevState.payments.find((candidate) => candidate.id === action.payload);
      if (!payment) return;
      const paymentResult = await db.from("payments").update({ status: "done" }).eq("id", action.payload);
      if (paymentResult.error) throw paymentResult.error;
      const account = nextState.accounts.find((candidate) => candidate.id === payment.accountId);
      if (account) result = await db.from("accounts").update({ balance: account.balance }).eq("id", account.id);
      break;
    }
    case "ADD_LOAN":
      result = await db.from("loans").insert(loanToRow(action.payload));
      break;
    case "UPDATE_LOAN":
      result = await db.from("loans").update(loanToRow(action.payload)).eq("id", action.payload.id);
      break;
    case "DELETE_LOAN":
      result = await db.from("loans").delete().eq("id", action.payload);
      break;
  }
  if (result?.error) throw new Error(result.error.message);
}
