export interface ReportSyncStateRow {
  cabinet_id: string;
  status: string;
  state: { periodDateFrom?: string; periodDateTo?: string; completedPeriodDateTo?: string } | null;
}

/** Не даёт месячному ОПиУ принять незавершённую первичную загрузку за полный факт. */
export function reportSyncBlocksMonth(
  row: ReportSyncStateRow | undefined,
  from: string,
  to: string,
  today: string,
): boolean {
  if (!row || row.status === "complete") return false;
  const periodFrom = String(row.state?.periodDateFrom ?? "");
  const periodTo = String(row.state?.periodDateTo ?? "");
  const effectiveTo = to < today ? to : today;
  const completedThrough = String(row.state?.completedPeriodDateTo ?? "");
  if (completedThrough >= effectiveTo) return false;
  return Boolean(periodFrom && periodTo && periodFrom <= effectiveTo && periodTo >= from);
}
