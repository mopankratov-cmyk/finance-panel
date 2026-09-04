import "server-only";

import { DEFAULT_STATE } from "@/lib/constants";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import type { Account, FinanceAction, FinanceState, Loan, Payment } from "@/lib/types";

type Db = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type AccountRow = { id: string; name: string; type: string; currency: string; balance: number; opening_balance?: number | null; opening_date?: string | null; created_at?: string };
type PaymentRow = { id: string; name: string; amount: number; type: string; category: string; account_id: string; company_id?: string | null; date: string; status: string; counterparty: string; comment: string | null; created_at?: string };
type LoanRow = { id: string; creditor: string; principal: number; rate_per_day: number; start_date: string; due_date: string; status: string; created_at?: string; annual_rate?: number | null; monthly_rate?: number | null; interest_frequency?: string | null; rate_mode?: string | null; day_count_basis?: number | null; interest_payout?: string | null; reinvest_every_periods?: number | null; extra_contributions?: unknown; tranches?: unknown };

const datedAmounts = (value: unknown): Array<{ date: string; amount: number }> => Array.isArray(value)
  ? value.flatMap((item) => item && typeof item === "object" && /^\d{4}-\d{2}-\d{2}$/.test(String((item as { date?: unknown }).date)) && Number.isFinite(Number((item as { amount?: unknown }).amount))
    ? [{ date: String((item as { date: string }).date), amount: Number((item as { amount: number }).amount) }]
    : [])
  : [];

// balance больше не пишется: остаток ведётся от opening_balance по платежам.
const accountToRow = (account: Account) => ({
  id: account.id,
  name: account.name,
  type: account.type,
  currency: account.currency,
  opening_balance: account.openingBalance ?? account.balance ?? 0,
  opening_date: account.openingDate ?? new Date().toISOString().slice(0, 10),
});

const paymentToRow = (payment: Payment) => ({
  id: payment.id,
  name: payment.name,
  amount: payment.amount,
  type: payment.amount >= 0 ? "income" : "expense",
  category: payment.category,
  account_id: payment.accountId,
  company_id: payment.companyId ?? null,
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
  // Условия договора — только если действие их несёт (до миграции колонок нет).
  ...(loan.terms ? {
    annual_rate: loan.terms.annualRate,
    monthly_rate: loan.terms.monthlyRate,
    interest_frequency: loan.terms.interestFrequency,
    rate_mode: loan.terms.rateMode,
    day_count_basis: loan.terms.dayCountBasis,
    interest_payout: loan.terms.interestPayout,
    reinvest_every_periods: loan.terms.reinvestEveryPeriods,
    extra_contributions: loan.terms.extraContributions,
    tranches: loan.terms.tranches,
  } : {}),
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
      openingBalance: row.opening_balance == null ? Number(row.balance) : Number(row.opening_balance),
      openingDate: row.opening_date ? String(row.opening_date).slice(0, 10) : null,
    })),
    payments: ((paymentsResult.data ?? []) as PaymentRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      amount: Number(row.amount),
      category: row.category,
      accountId: row.account_id,
      companyId: row.company_id ?? null,
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
      terms: row.rate_mode ? {
        annualRate: row.annual_rate == null ? null : Number(row.annual_rate),
        monthlyRate: row.monthly_rate == null ? null : Number(row.monthly_rate),
        interestFrequency: row.interest_frequency === "monthly" || row.interest_frequency === "quarterly" || row.interest_frequency === "at_maturity" ? row.interest_frequency : null,
        rateMode: row.rate_mode === "flat_period" ? "flat_period" : "actual_days",
        dayCountBasis: row.day_count_basis === 360 ? 360 : row.day_count_basis === 366 ? 366 : 365,
        interestPayout: row.interest_payout === "capitalized" ? "capitalized" : "paid",
        reinvestEveryPeriods: row.reinvest_every_periods == null ? null : Number(row.reinvest_every_periods),
        extraContributions: datedAmounts(row.extra_contributions),
        tranches: datedAmounts(row.tranches),
      } : undefined,
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
  // Снимки состояния больше не нужны (их читала мёртвая ветка MARK_PAYMENT_DONE); клиент их всё ещё шлёт.
  _prevState: FinanceState,
  _nextState: FinanceState,
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
