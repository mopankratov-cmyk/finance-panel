import type { Loan } from "@/lib/types";
import type { LoanScheduleDraft } from "./schedule";

export interface LoanBalancePoint {
  rowId: string;
  balanceAfter: number;
}

export interface MonthlyLoanSummary {
  month: string;
  interestAccrued: number;
  principalBalance: number;
  scheduledTotal: number;
  paidTotal: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Остаток ПОСЛЕ каждой договорной строки. Плановая строка тоже уменьшает
 * прогнозный остаток; отменённая — нет. Если договор дал собственный остаток
 * (транши, капитализация, реинвест), он сильнее простого вычитания тела.
 */
export function projectedLoanBalances(principal: number, schedule: readonly LoanScheduleDraft[]): LoanBalancePoint[] {
  let balance = Math.max(0, principal);
  return [...schedule]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((row) => {
      if (row.status !== "cancelled") {
        const hasContractBalance = Number.isFinite(row.balanceBefore)
          && Number.isFinite(row.balanceAfter)
          && (Number(row.balanceBefore) > 0 || Number(row.balanceAfter) > 0);
        balance = hasContractBalance
          ? Math.max(0, Number(row.balanceAfter))
          : Math.max(0, balance - Math.max(0, Number(row.principal || 0)));
      }
      return { rowId: row.id, balanceAfter: round2(balance) };
    });
}

/** Фактический остаток на дату: плановый платёж не считается совершённым. */
export function actualLoanBalance(principal: number, schedule: readonly LoanScheduleDraft[], asOf: string): number {
  let balance = Math.max(0, principal);
  for (const row of [...schedule].sort((left, right) => left.date.localeCompare(right.date))) {
    if (row.date > asOf || row.status === "cancelled") continue;
    const hasContractBalance = Number.isFinite(row.balanceBefore)
      && Number.isFinite(row.balanceAfter)
      && (Number(row.balanceBefore) > 0 || Number(row.balanceAfter) > 0);
    if (hasContractBalance) {
      balance = row.status === "done" && Number.isFinite(row.balanceAfter)
        ? Number(row.balanceAfter)
        : Number(row.balanceBefore);
    } else if (row.status === "done") {
      balance = Math.max(0, balance - Math.max(0, Number(row.principal || 0)));
    }
  }
  return round2(Math.max(0, balance));
}

function monthEnd(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return `${month}-${String(new Date(year, value, 0).getDate()).padStart(2, "0")}`;
}

export function buildMonthlyLoanSummary(
  loans: readonly Pick<Loan, "id" | "principalAmount">[],
  schedules: ReadonlyMap<string, readonly LoanScheduleDraft[]>,
  periodStart: string,
  periodEnd: string,
): MonthlyLoanSummary[] {
  const months: string[] = [];
  const cursor = new Date(`${periodStart.slice(0, 7)}-01T12:00:00`);
  const last = periodEnd.slice(0, 7);
  while (cursor.toISOString().slice(0, 7) <= last && months.length < 240) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months.map((month) => {
    const rows = loans.flatMap((loan) => (schedules.get(loan.id) ?? [])
      .filter((row) => row.date.startsWith(month) && row.status !== "cancelled"));
    const end = monthEnd(month);
    return {
      month,
      interestAccrued: round2(rows.reduce((sum, row) => sum + row.interest + row.penalty + row.fine, 0)),
      principalBalance: round2(loans.reduce((sum, loan) => sum + actualLoanBalance(loan.principalAmount, schedules.get(loan.id) ?? [], end), 0)),
      scheduledTotal: round2(rows.reduce((sum, row) => sum + row.principal + row.interest + row.penalty + row.fine, 0)),
      paidTotal: round2(rows.filter((row) => row.status === "done").reduce((sum, row) => sum + row.principal + row.interest + row.penalty + row.fine, 0)),
    };
  });
}
