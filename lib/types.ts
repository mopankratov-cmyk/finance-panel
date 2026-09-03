export type AccountType = "marketplace" | "bank" | "cash";
export type Currency = "RUB" | "USD";
export type PaymentStatus = "planned" | "done" | "cancelled";
export type LoanStatus = "active" | "closed";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  balance: number;
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

export interface Loan {
  id: string;
  creditorName: string;
  principalAmount: number;
  interestRatePerDay: number;
  startDate: string;
  dueDate: string;
  status: LoanStatus;
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
  | { type: "MARK_PAYMENT_DONE"; payload: string }
  | { type: "ADD_LOAN"; payload: Loan }
  | { type: "UPDATE_LOAN"; payload: Loan }
  | { type: "DELETE_LOAN"; payload: string };
