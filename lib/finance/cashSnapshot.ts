export interface BankStatementForOpening {
  id: string;
  dateFrom: string | null;
  dateTo: string | null;
  openingBalance: number | null;
}

export interface BankTransactionForOpening {
  statementId: string;
  date: string;
  amount: number;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Конец предыдущего дня равен входящему остатку выбранного дня. */
export function dayBefore(day: string): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

/**
 * Восстанавливает остаток на начало дня даже для выписки, начавшейся раньше:
 * входящий остаток выписки + все движения до выбранного дня.
 */
export function bankOpeningAtDate(
  statement: BankStatementForOpening,
  transactions: readonly BankTransactionForOpening[],
  day: string,
): number | null {
  if (statement.openingBalance === null || !statement.dateFrom || !statement.dateTo) return null;
  if (statement.dateFrom > day || statement.dateTo < day) return null;
  return round2(statement.openingBalance + transactions
    .filter((row) => row.statementId === statement.id && row.date >= statement.dateFrom! && row.date < day)
    .reduce((sum, row) => sum + row.amount, 0));
}

export function cashDifference(statementAmount: number, ddsAmount: number) {
  return round2(statementAmount - ddsAmount);
}
