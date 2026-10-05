import type { Payment } from "@/lib/types";

export type ForecastMarketplace = "wb" | "ozon";
export type ForecastRowSource = "forecast" | "financial_report";

export interface ForecastPublishRow {
  key: string;
  date: string;
  amount: number;
  source: ForecastRowSource;
  reportId?: string;
  state?: "awaiting_transfer" | "marketplace_sent";
}

export interface ForecastPublishScope {
  marketplace: ForecastMarketplace;
  cabinetId: string;
  companyId: string;
  accountId: string;
  year: number;
  month: number;
}

export interface ConfirmedMarketplacePayout {
  key: string;
  date: string;
  amount: number;
}

const hash = (value: string) => {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
};

const safe = (value: string) => value.replace(/[\[\]\r\n]/g, " ").trim().slice(0, 160);

export function forecastScopeKey(scope: Omit<ForecastPublishScope, "accountId">) {
  return `${scope.marketplace}:${hash(`${scope.cabinetId}|${scope.companyId}|${scope.year}-${scope.month}`)}`;
}

export function buildForecastPayments(scope: ForecastPublishScope, rows: ForecastPublishRow[]): Payment[] {
  const scopeKey = forecastScopeKey(scope);
  const marketplaceName = scope.marketplace === "wb" ? "Wildberries" : "Ozon";
  return rows.map((row) => {
    const rowKey = safe(row.key || row.reportId || row.date);
    const id = `forecast-${hash(`${scopeKey}|${rowKey}`)}`;
    const sourceLabel = row.state === "awaiting_transfer"
      ? "ожидается перечисление"
      : row.state === "marketplace_sent"
        ? "отправлено маркетплейсом"
        : row.source === "financial_report" ? "подтверждено отчётом" : "расчётный прогноз";
    return {
      id,
      date: row.date,
      name: `Поступление ${marketplaceName} — ${sourceLabel}`,
      amount: Math.round(row.amount * 100) / 100,
      category: `Поступление — Продажи на МП — ${marketplaceName}`,
      accountId: scope.accountId,
      status: "planned",
      counterparty: marketplaceName,
      comment: `[forecast-scope:${scopeKey}] [forecast-marketplace:${scope.marketplace}] [forecast-cabinet:${safe(scope.cabinetId)}] [forecast-company:${safe(scope.companyId)}] [forecast-period:${scope.year}-${String(scope.month).padStart(2, "0")}] [forecast-row:${rowKey}] [forecast-source:${row.source}]${row.reportId ? ` [forecast-report:${safe(row.reportId)}]` : ""}${row.state ? ` [forecast-state:${row.state}]` : ""}`,
    };
  });
}

export function mergeForecastPublication(existing: Payment[], desired: Payment[], scopeKey: string) {
  const marker = `[forecast-scope:${scopeKey}]`;
  const desiredIds = new Set(desired.map((payment) => payment.id));
  const stale = existing
    .filter((payment) => payment.comment?.includes(marker) && payment.status === "planned" && !desiredIds.has(payment.id))
    .map((payment) => ({ ...payment, status: "cancelled" as const }));
  return [...desired, ...stale];
}

const sourceMarker = (payment: Payment, source: ForecastRowSource) =>
  payment.comment?.includes(`[forecast-source:${source}]`) ?? false;

/**
 * Заменяет расчётную часть уже утверждённого календаря точными суммами
 * финансовых отчётов. Строки, которые уже закрыты фактом ДДС, не воскресают.
 * Неотчётный остаток сохраняется только пока в календаре есть расчётные строки.
 */
export function rowsAfterConfirmedReports(
  scope: ForecastPublishScope,
  existing: Payment[],
  reports: ConfirmedMarketplacePayout[],
): ForecastPublishRow[] {
  const planned = existing.filter((payment) => payment.status === "planned");
  const preliminary = planned.filter((payment) => sourceMarker(payment, "forecast"));
  const reportRows: ForecastPublishRow[] = reports.map((report) => ({
    key: report.key,
    reportId: report.key,
    date: report.date,
    amount: Math.round(report.amount * 100) / 100,
    source: "financial_report",
  }));
  const reportPayments = buildForecastPayments(scope, reportRows);
  const completedIds = new Set(
    existing.filter((payment) => payment.status === "done").map((payment) => payment.id),
  );
  const outstandingReports = reportRows.filter((_, index) => !completedIds.has(reportPayments[index].id));

  if (preliminary.length === 0) return outstandingReports;

  const currentPlannedCents = planned.reduce(
    (sum, payment) => sum + Math.max(0, Math.round(payment.amount * 100)),
    0,
  );
  const reportCents = outstandingReports.reduce(
    (sum, report) => sum + Math.max(0, Math.round(report.amount * 100)),
    0,
  );
  const remainderCents = Math.max(0, currentPlannedCents - reportCents);
  const weights = preliminary.map((payment) => Math.max(0, Math.round(payment.amount * 100)));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (remainderCents === 0 || totalWeight === 0) return outstandingReports;

  let allocated = 0;
  const forecastRows = preliminary.map((payment, index) => {
    const cents = index === preliminary.length - 1
      ? remainderCents - allocated
      : Math.floor(remainderCents * weights[index] / totalWeight);
    allocated += cents;
    const key = payment.comment?.match(/\[forecast-row:([^\]]+)\]/)?.[1] ?? payment.id;
    return {
      key,
      date: payment.date,
      amount: cents / 100,
      source: "forecast" as const,
    };
  }).filter((row) => row.amount > 0);

  return [...outstandingReports, ...forecastRows];
}
