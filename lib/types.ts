export type AccountType = "marketplace" | "bank" | "cash";
export type Currency = "RUB" | "USD";
export type PaymentStatus = "planned" | "done" | "cancelled";
export type LoanStatus = "active" | "closed";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  /** @deprecated Ручной остаток; после появления openingDate не пишется и служит только запасным значением. */
  balance: number;
  /** Остаток на начало openingDate; текущий = openingBalance + факты с openingDate (lib/finance/balance.ts). */
  openingBalance?: number;
  openingDate?: string | null;
}

export interface Payment {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  accountId: string;
  companyId?: string | null;
  status: PaymentStatus;
  counterparty: string;
  comment?: string;
}

/** Условия договора для расчёта графика от остатка долга (lib/loans/scheduleModel.ts). */
export interface LoanTermsStored {
  annualRate: number | null;
  monthlyRate: number | null;
  interestFrequency: "monthly" | "quarterly" | "at_maturity" | null;
  rateMode: "flat_period" | "actual_days";
  dayCountBasis: 365 | 366 | 360;
  interestPayout: "paid" | "capitalized";
  paymentDay?: number | null;
  reinvestEveryPeriods: number | null;
  extraContributions: Array<{ date: string; amount: number }>;
  tranches: Array<{ date: string; amount: number }>;
}

export interface Loan {
  id: string;
  creditorName: string;
  principalAmount: number;
  interestRatePerDay: number;
  startDate: string;
  dueDate: string;
  status: LoanStatus;
  /** Появляется после миграции loan_schedule_rows; до неё — undefined. */
  terms?: LoanTermsStored;
}

export interface FinanceState {
  accounts: Account[];
  payments: Payment[];
  loans: Loan[];
}

export type FinanceAction =
  | { type: "LOAD"; payload: FinanceState }
  | { type: "ADD_ACCOUNT"; payload: Account }
  | { type: "UPDATE_ACCOUNT"; payload: Account }
  | { type: "DELETE_ACCOUNT"; payload: string }
  | { type: "ADD_PAYMENT"; payload: Payment }
  | { type: "UPDATE_PAYMENT"; payload: Payment }
  | { type: "DELETE_PAYMENT"; payload: string }
  | { type: "ADD_LOAN"; payload: Loan }
  | { type: "UPDATE_LOAN"; payload: Loan }
  | { type: "DELETE_LOAN"; payload: string };
