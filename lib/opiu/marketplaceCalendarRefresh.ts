import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { fetchWbFinanceReportSummaries } from "@/lib/wb/financeApi";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { marketplacePayoutDate } from "@/lib/opiu/marketplacePayoutDate";
import {
  buildForecastPayments,
  forecastScopeKey,
  mergeForecastPublication,
  rowsAfterConfirmedReports,
  type ConfirmedMarketplacePayout,
  type ForecastMarketplace,
  type ForecastPublishScope,
} from "@/lib/opiu/calendarForecastPublish";
import {
  loadOzonCashFlowReports,
  reportBelongsToMonth,
} from "@/lib/opiu/ozonForecastPolicy";
import { payoutReportKey } from "@/lib/opiu/payoutReconciliation";
import type { Payment } from "@/lib/types";

interface CalendarRow {
  id: string;
  date: string;
  name: string | null;
  amount: number;
  category: string | null;
  account_id: string | null;
  company_id: string | null;
  status: Payment["status"];
  counterparty: string | null;
  comment: string | null;
  settled_by_payment_id: string | null;
}

const marker = (comment: string, name: string) =>
  comment.match(new RegExp(`\\[${name}:([^\\]]+)\\]`))?.[1]?.trim() ?? "";

function paymentFromRow(row: CalendarRow): Payment {
  return {
    id: row.id,
    date: row.date,
    name: row.name ?? "",
    amount: Number(row.amount),
    category: row.category ?? "",
    accountId: row.account_id ?? "",
    companyId: row.company_id,
    status: row.status,
    counterparty: row.counterparty ?? "",
    comment: row.comment ?? undefined,
    settledByPaymentId: row.settled_by_payment_id,
  };
}

function scopeFromRow(row: CalendarRow): ForecastPublishScope | null {
  const comment = row.comment ?? "";
  const marketplace = marker(comment, "forecast-marketplace") as ForecastMarketplace;
  const cabinetId = marker(comment, "forecast-cabinet");
  const period = marker(comment, "forecast-period").match(/^(\d{4})-(\d{2})$/);
  if (!period || !["wb", "ozon"].includes(marketplace) || !cabinetId || !row.company_id || !row.account_id) return null;
  return {
    marketplace,
    cabinetId,
    companyId: row.company_id,
    accountId: row.account_id,
    year: Number(period[1]),
    month: Number(period[2]),
  };
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

async function reportsForScope(
  scope: ForecastPublishScope,
  ozonCreds?: { clientId: string; apiKey: string },
): Promise<ConfirmedMarketplacePayout[]> {
  const start = new Date(Date.UTC(scope.year, scope.month - 1, 1, 12));
  const end = new Date(Date.UTC(scope.year, scope.month, 0, 12));
  if (scope.marketplace === "wb") {
    const cabinet = await getWbCabinet(scope.cabinetId);
    if (!cabinet) throw new Error("Кабинет WB не найден для обновления календаря");
    const token = resolveWbToken(cabinet, "statistics");
    const reports = await fetchWbFinanceReportSummaries(token, iso(start), iso(end));
    return reports.flatMap((report) => {
      const date = marketplacePayoutDate(report.periodTo);
      return report.forPaySum !== null && report.forPaySum > 0 && date
        ? [{ key: report.reportId, date, amount: report.forPaySum }]
        : [];
    });
  }
  if (!ozonCreds) throw new Error("Нет реквизитов API кабинета Ozon для обновления календаря");
  const result = await loadOzonCashFlowReports({
    creds: ozonCreds,
    from: addDays(start, -31),
    to: addDays(end, 31),
    rules: { mode: "standard", weeklyDay: 3, standardDelayDays: 21 },
    identity: { cabinetId: scope.cabinetId, companyId: scope.companyId },
  });
  if (result.degraded) throw new Error("Ozon вернул неполный финансовый отчёт; календарь не изменён");
  return result.reports
    .filter((report) => reportBelongsToMonth(report, scope.year, scope.month))
    .map((report) => ({
      key: payoutReportKey(report),
      date: report.estimatedReceiptDate,
      amount: report.amount,
    }));
}

export async function refreshPublishedMarketplacePayouts({
  marketplace,
  cabinetId,
  ozonCreds,
}: {
  marketplace: ForecastMarketplace;
  cabinetId: string;
  ozonCreds?: { clientId: string; apiKey: string };
}) {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase не настроен");
  const rows = await loadAllSupabasePages<CalendarRow>(async (from, to) => {
    const result = await db.from("payments")
      .select("id,date,name,amount,category,account_id,company_id,status,counterparty,comment,settled_by_payment_id")
      .like("comment", `%[forecast-marketplace:${marketplace}]%`)
      .like("comment", `%[forecast-cabinet:${cabinetId}]%`)
      .in("status", ["planned", "done"])
      .order("id", { ascending: true })
      .range(from, to);
    return { data: result.data as CalendarRow[] | null, error: result.error };
  }, { label: "Планы выплат маркетплейса" });

  const groups = new Map<string, { scope: ForecastPublishScope; rows: CalendarRow[] }>();
  for (const row of rows) {
    const scope = scopeFromRow(row);
    if (!scope || scope.marketplace !== marketplace || scope.cabinetId !== cabinetId) continue;
    const key = forecastScopeKey(scope);
    const group = groups.get(key) ?? { scope, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  let updated = 0;
  for (const { scope, rows: scopeRows } of groups.values()) {
    const existing = scopeRows.map(paymentFromRow);
    if (!existing.some((payment) => payment.status === "planned")) continue;
    const reports = await reportsForScope(scope, ozonCreds);
    if (reports.length === 0) continue;
    const publishRows = rowsAfterConfirmedReports(scope, existing, reports);
    const desired = buildForecastPayments(scope, publishRows);
    const merged = mergeForecastPublication(existing, desired, forecastScopeKey(scope));
    const payload = merged.map((payment) => ({
      id: payment.id,
      name: payment.name,
      amount: payment.amount,
      type: "income",
      category: payment.category,
      account_id: payment.accountId,
      date: payment.date,
      status: payment.status,
      counterparty: payment.counterparty,
      comment: payment.comment ?? null,
      company_id: scope.companyId,
    }));
    if (!payload.length) continue;
    const saved = await db.from("payments").upsert(payload, { onConflict: "id" });
    if (saved.error) throw new Error(`Календарь выплат не обновлён: ${saved.error.message}`);
    updated += desired.length;
  }
  return { scopes: groups.size, updated };
}
