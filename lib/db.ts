import { DEFAULT_STATE } from "./constants";
import { supabase } from "./supabase";
import type {
  Account,
  FinanceAction,
  FinanceState,
  Loan,
  Payment,
} from "./types";

interface AccountRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  created_at?: string;
}

interface PaymentRow {
  id: string;
  name: string;
  amount: number;
  type: string;
  category: string;
  account_id: string;
  date: string;
  status: string;
  counterparty: string;
  comment: string | null;
  created_at?: string;
}

interface LoanRow {
  id: string;
  creditor: string;
  principal: number;
  rate_per_day: number;
  start_date: string;
  due_date: string;
  status: string;
  created_at?: string;
}

function paymentFlowType(amount: number): "income" | "expense" {
  return amount >= 0 ? "income" : "expense";
}

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Account["type"],
    currency: row.currency as Account["currency"],
    balance: Number(row.balance),
  };
}

function rowToPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    category: row.category,
    accountId: row.account_id,
    date: row.date,
    status: row.status as Payment["status"],
    counterparty: row.counterparty ?? "",
    comment: row.comment ?? undefined,
  };
}

function rowToLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    creditorName: row.creditor,
    principalAmount: Number(row.principal),
    interestRatePerDay: Number(row.rate_per_day),
    startDate: row.start_date,
    dueDate: row.due_date,
    status: row.status as Loan["status"],
  };
}

function accountToRow(account: Account): Omit<AccountRow, "created_at"> {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    balance: account.balance,
  };
}

function paymentToRow(payment: Payment): Omit<PaymentRow, "created_at"> {
  return {
    id: payment.id,
    name: payment.name,
    amount: payment.amount,
    type: paymentFlowType(payment.amount),
    category: payment.category,
    account_id: payment.accountId,
    date: payment.date,
    status: payment.status,
    counterparty: payment.counterparty,
    comment: payment.comment ?? null,
  };
}

function loanToRow(loan: Loan): Omit<LoanRow, "created_at"> {
  return {
    id: loan.id,
    creditor: loan.creditorName,
    principal: loan.principalAmount,
    rate_per_day: loan.interestRatePerDay,
    start_date: loan.startDate,
    due_date: loan.dueDate,
    status: loan.status,
  };
}

function buildSeedState(): FinanceState {
  const accountIdMap = new Map<string, string>();

  const accounts = DEFAULT_STATE.accounts.map((account) => {
    const id = crypto.randomUUID();
    accountIdMap.set(account.id, id);
    return { ...account, id };
  });

  const payments = DEFAULT_STATE.payments.map((payment) => ({
    ...payment,
    id: crypto.randomUUID(),
    accountId: accountIdMap.get(payment.accountId) ?? payment.accountId,
  }));

  const loans = DEFAULT_STATE.loans.map((loan) => ({
    ...loan,
    id: crypto.randomUUID(),
  }));

  return { accounts, payments, loans };
}

async function seedDatabase(): Promise<void> {
  const seedState = buildSeedState();

  const { error: accountsError } = await supabase
    .from("accounts")
    .insert(seedState.accounts.map(accountToRow));

  if (accountsError) throw accountsError;

  if (seedState.payments.length > 0) {
    const { error: paymentsError } = await supabase
      .from("payments")
      .insert(seedState.payments.map(paymentToRow));

    if (paymentsError) throw paymentsError;
  }

  if (seedState.loans.length > 0) {
    const { error: loansError } = await supabase
      .from("loans")
      .insert(seedState.loans.map(loanToRow));

    if (loansError) throw loansError;
  }
}

export async function loadFinanceState(): Promise<FinanceState> {
  const [accountsRes, paymentsRes, loansRes] = await Promise.all([
    supabase.from("accounts").select("*").order("created_at"),
    supabase.from("payments").select("*").order("date", { ascending: false }),
    supabase.from("loans").select("*").order("created_at"),
  ]);

  if (accountsRes.error) throw accountsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;
  if (loansRes.error) throw loansRes.error;

  const accounts = (accountsRes.data as AccountRow[]).map(rowToAccount);
  const payments = (paymentsRes.data as PaymentRow[]).map(rowToPayment);
  const loans = (loansRes.data as LoanRow[]).map(rowToLoan);

  if (accounts.length === 0 && payments.length === 0 && loans.length === 0) {
    await seedDatabase();
    return loadFinanceState();
  }

  return { accounts, payments, loans };
}

export async function persistFinanceAction(
  action: FinanceAction,
  prevState: FinanceState,
  nextState: FinanceState,
): Promise<void> {
  switch (action.type) {
    case "LOAD":
      return;

    case "ADD_ACCOUNT": {
      const { error } = await supabase
        .from("accounts")
        .insert(accountToRow(action.payload));
      if (error) throw error;
      break;
    }

    case "UPDATE_ACCOUNT": {
      const { error } = await supabase
        .from("accounts")
        .update(accountToRow(action.payload))
        .eq("id", action.payload.id);
      if (error) throw error;
      break;
    }

    case "DELETE_ACCOUNT": {
      const { error } = await supabase
        .from("accounts")
        .delete()
        .eq("id", action.payload);
      if (error) throw error;
      break;
    }

    case "ADD_PAYMENT": {
      const { error } = await supabase
        .from("payments")
        .insert(paymentToRow(action.payload));
      if (error) throw error;
      break;
    }

    case "UPDATE_PAYMENT": {
      const { error } = await supabase
        .from("payments")
        .update(paymentToRow(action.payload))
        .eq("id", action.payload.id);
      if (error) throw error;
      break;
    }

    case "DELETE_PAYMENT": {
      const { error } = await supabase
        .from("payments")
        .delete()
        .eq("id", action.payload);
      if (error) throw error;
      break;
    }

    case "MARK_PAYMENT_DONE": {
      const payment = prevState.payments.find((p) => p.id === action.payload);
      if (!payment) return;

      const { error: paymentError } = await supabase
        .from("payments")
        .update({ status: "done" })
        .eq("id", action.payload);
      if (paymentError) throw paymentError;

      const account = nextState.accounts.find(
        (a) => a.id === payment.accountId,
      );
      if (account) {
        const { error: accountError } = await supabase
          .from("accounts")
          .update({ balance: account.balance })
          .eq("id", account.id);
        if (accountError) throw accountError;
      }
      break;
    }

    case "ADD_LOAN": {
      const { error } = await supabase
        .from("loans")
        .insert(loanToRow(action.payload));
      if (error) throw error;
      break;
    }

    case "UPDATE_LOAN": {
      const { error } = await supabase
        .from("loans")
        .update(loanToRow(action.payload))
        .eq("id", action.payload.id);
      if (error) throw error;
      break;
    }

    case "DELETE_LOAN": {
      const { error } = await supabase
        .from("loans")
        .delete()
        .eq("id", action.payload);
      if (error) throw error;
      break;
    }
  }
}
