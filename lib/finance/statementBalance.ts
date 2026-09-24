import { actualLoanBalance } from "@/lib/loans/portfolioSummary";
import { scheduleDraftFromRows, type ScheduleRowRecord } from "@/lib/loans/scheduleRows";
import type { Loan } from "@/lib/types";

export interface LoanLiabilitySnapshot {
  amount: number;
  details: Array<{ id: string; name: string; amount: number; estimated: boolean }>;
  estimatedCount: number;
}

/**
 * Остаток тела кредитов на дату. График сильнее исходной суммы договора;
 * для старых договоров без строк графика сохраняем исходную сумму и честно
 * помечаем её оценкой, а не выдаём за точный остаток.
 */
export function loanLiabilitySnapshot(
  loans: readonly Loan[],
  rows: readonly ScheduleRowRecord[],
  asOf: string,
): LoanLiabilitySnapshot {
  const details = loans
    .filter((loan) => loan.status === "active" && loan.startDate <= asOf)
    .map((loan) => {
      const loanRows = rows.filter((row) => row.loanId === loan.id);
      const estimated = loanRows.length === 0;
      const amount = estimated
        ? Math.max(0, loan.principalAmount)
        : actualLoanBalance(loan.principalAmount, scheduleDraftFromRows(loanRows), asOf);
      return { id: loan.id, name: loan.creditorName, amount, estimated };
    })
    .sort((left, right) => right.amount - left.amount);

  return {
    amount: details.reduce((sum, item) => sum + item.amount, 0),
    details,
    estimatedCount: details.filter((item) => item.estimated).length,
  };
}

export function connectedBalanceTotals(input: {
  cash: number;
  inventory: number;
  loans: number;
}) {
  const assets = input.cash + input.inventory;
  const liabilities = input.loans;
  return {
    assets,
    liabilities,
    calculatedEquity: assets - liabilities,
    debtShare: assets > 0 ? liabilities / assets : null,
    autonomy: assets > 0 ? (assets - liabilities) / assets : null,
  };
}
