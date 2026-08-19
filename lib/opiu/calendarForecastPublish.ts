import type { Payment } from "@/lib/types";

export type ForecastMarketplace = "wb" | "ozon";
export type ForecastRowSource = "forecast" | "financial_report";

export interface ForecastPublishRow {
  key: string;
  date: string;
  amount: number;
  source: ForecastRowSource;
  reportId?: string;
}

export interface ForecastPublishScope {
  marketplace: ForecastMarketplace;
  cabinetId: string;
  companyId: string;
  accountId: string;
  year: number;
  month: number;
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
    const sourceLabel = row.source === "financial_report" ? "подтверждено отчётом" : "расчётный прогноз";
    return {
      id,
      date: row.date,
      name: `Поступление ${marketplaceName} — ${sourceLabel}`,
      amount: Math.round(row.amount * 100) / 100,
      category: `Поступление — Продажи на МП — ${marketplaceName}`,
      accountId: scope.accountId,
      status: "planned",
      counterparty: marketplaceName,
      comment: `[forecast-scope:${scopeKey}] [forecast-marketplace:${scope.marketplace}] [forecast-cabinet:${safe(scope.cabinetId)}] [forecast-company:${safe(scope.companyId)}] [forecast-period:${scope.year}-${String(scope.month).padStart(2, "0")}] [forecast-row:${rowKey}] [forecast-source:${row.source}]${row.reportId ? ` [forecast-report:${safe(row.reportId)}]` : ""}`,
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
