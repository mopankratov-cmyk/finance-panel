import type { Account, Loan, Payment } from "./types";
import { todayISO } from "./format";

export function getTotalBalance(accounts: Account[]): number {
  return accounts.reduce((sum, acc) => sum + acc.balance, 0);
}

export function getTotalBalanceByCurrency(
  accounts: Account[],
): Record<string, number> {
  return accounts.reduce(
    (totals, acc) => {
      totals[acc.currency] = (totals[acc.currency] || 0) + acc.balance;
      return totals;
    },
    {} as Record<string, number>,
  );
}

export function getActivePayments(payments: Payment[]): Payment[] {
  return payments.filter((p) => p.status !== "cancelled");
}

export function getPaymentsForWeek(
  payments: Payment[],
  fromDate?: string,
): Payment[] {
  const start = fromDate ? new Date(fromDate) : new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const startStr = toLocalISO(start);
  const endStr = toLocalISO(end);

  return getActivePayments(payments)
    .filter((p) => p.date >= startStr && p.date < endStr)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getRecentTransactions(
  payments: Payment[],
  limit = 10,
): Payment[] {
  // Отменённый платёж — не операция; в «последних» ему не место.
  return getActivePayments(payments)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export interface DayInfo {
  date: string;
  balance: number;
  netFlow: number;
  payments: Payment[];
  isNegative: boolean;
  dayType: "income" | "expense" | "neutral";
}

export function getDaysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const date = new Date(year, month, 1);
  while (date.getMonth() === month) {
    days.push(toLocalISO(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}

export function getDailyBalancesForMonth(
  year: number,
  month: number,
  totalBalance: number,
  payments: Payment[],
): Map<string, DayInfo> {
  const today = todayISO();
  const days = getDaysInMonth(year, month);
  const activePayments = getActivePayments(payments);
  const result = new Map<string, DayInfo>();

  for (const dayStr of days) {
    let balance = totalBalance;

    if (dayStr > today) {
      for (const p of activePayments) {
        if (p.date > today && p.date <= dayStr) {
          balance += p.amount;
        }
      }
    } else if (dayStr < today) {
      for (const p of activePayments) {
        if (p.date > dayStr && p.date <= today) {
          balance -= p.amount;
        }
      }
    }

    const dayPayments = activePayments.filter((p) => p.date === dayStr);
    const netFlow = dayPayments.reduce((sum, p) => sum + p.amount, 0);

    let dayType: DayInfo["dayType"] = "neutral";
    if (netFlow > 0) dayType = "income";
    else if (netFlow < 0) dayType = "expense";

    result.set(dayStr, {
      date: dayStr,
      balance,
      netFlow,
      payments: dayPayments,
      isNegative: balance < 0,
      dayType,
    });
  }

  return result;
}

export function getNegativeBalanceDays(
  year: number,
  month: number,
  totalBalance: number,
  payments: Payment[],
): DayInfo[] {
  const dailyMap = getDailyBalancesForMonth(
    year,
    month,
    totalBalance,
    payments,
  );
  const today = todayISO();
  return Array.from(dailyMap.values()).filter(
    (d) => d.isNegative && d.date >= today,
  );
}

export function calculateLoanTotalOwed(loan: Loan): number {
  if (loan.status === "closed") return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = parseLocalDate(loan.startDate);
  const due = parseLocalDate(loan.dueDate);

  const endDate = today < due ? today : due;
  const daysElapsed = Math.max(
    0,
    Math.floor((endDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
  );

  const interest =
    loan.principalAmount * (loan.interestRatePerDay / 100) * daysElapsed;
  return loan.principalAmount + interest;
}

export interface WeekSummary {
  weekNumber: number;
  startDate: string;
  endDate: string;
  netFlow: number;
  totalIncome: number;
  totalExpense: number;
  runningBalance: number;
}

export function getWeekBounds(dateStr: string): {
  startDate: string;
  endDate: string;
  weekNumber: number;
} {
  const date = parseLocalDate(dateStr);
  const dayOfWeek = (date.getDay() + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - dayOfWeek);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return {
    startDate: toLocalISO(start),
    endDate: toLocalISO(end),
    weekNumber: getISOWeekNumber(date),
  };
}

export function getBalanceAtDate(
  dateStr: string,
  totalBalance: number,
  payments: Payment[],
): number {
  const today = todayISO();
  const activePayments = getActivePayments(payments);
  let balance = totalBalance;

  if (dateStr > today) {
    for (const p of activePayments) {
      if (p.date > today && p.date <= dateStr) {
        balance += p.amount;
      }
    }
  } else if (dateStr < today) {
    for (const p of activePayments) {
      if (p.date > dateStr && p.date <= today) {
        balance -= p.amount;
      }
    }
  }

  return balance;
}

export function getWeekSummary(
  dateStr: string,
  totalBalance: number,
  payments: Payment[],
): WeekSummary {
  const { startDate, endDate, weekNumber } = getWeekBounds(dateStr);
  const activePayments = getActivePayments(payments);
  const weekPayments = activePayments.filter(
    (p) => p.date >= startDate && p.date <= endDate,
  );

  const netFlow = weekPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalIncome = weekPayments
    .filter((p) => p.amount > 0)
    .reduce((sum, p) => sum + p.amount, 0);
  const totalExpense = Math.abs(
    weekPayments
      .filter((p) => p.amount < 0)
      .reduce((sum, p) => sum + p.amount, 0),
  );

  return {
    weekNumber,
    startDate,
    endDate,
    netFlow,
    totalIncome,
    totalExpense,
    runningBalance: getBalanceAtDate(endDate, totalBalance, payments),
  };
}

export function sumActivePayments(
  payments: Payment[],
  filter: (p: Payment) => boolean,
): { income: number; expense: number; net: number } {
  const active = payments.filter((p) => p.status !== "cancelled" && filter(p));
  const income = active
    .filter((p) => p.amount > 0)
    .reduce((sum, p) => sum + p.amount, 0);
  const expense = Math.abs(
    active
      .filter((p) => p.amount < 0)
      .reduce((sum, p) => sum + p.amount, 0),
  );
  return { income, expense, net: income - expense };
}

// ISO 8601: неделя принадлежит году своего четверга. Прежний сдвиг «+4 − пн + 1»
// целил в субботу, и весь 2027 год нумеровался на единицу больше
// (1 января 2027 — пятница, по ISO это 53-я неделя 2026-го).
export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function toLocalISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}
