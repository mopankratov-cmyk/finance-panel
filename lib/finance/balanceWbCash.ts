import type { WbFinanceReportSummary } from "@/lib/wb/financeApi";

export interface ScopedWbReportRow {
  realizationreport_id: number | string | null;
  doc_type_name: string | null;
  supplier_oper_name: string | null;
  ppvz_for_pay: number | null;
}

export interface BalanceWbCashLine {
  reportId: string;
  periodFrom: string;
  periodTo: string;
  availableDate: string;
  expectedReceiptDate: string;
  brandForPay: number;
  sellerForPay: number | null;
  sellerTotal: number | null;
  brandShare: number | null;
  amount: number;
  state: "frozen" | "available" | "expected_in_bank";
}

export interface BalanceWbCashCalculation {
  amount: number;
  availableAmount: number;
  lines: BalanceWbCashLine[];
  warnings: string[];
}

const DAY_MS = 86_400_000;
const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** День запроса не считается; суббота и воскресенье не рабочие. */
export function addBusinessDays(date: string, businessDays: number) {
  let result = date;
  let remaining = businessDays;
  while (remaining > 0) {
    result = addDays(result, 1);
    const day = new Date(`${result}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

export function wbReportSettlementDates(report: Pick<WbFinanceReportSummary, "periodTo" | "createDate">) {
  const createDate = report.createDate ?? addDays(report.periodTo, 1);
  // По действующему регламенту WB сумма становится доступной через две
  // недели после формирования отчёта. Банк получает её не позднее семи
  // рабочих дней после запроса, который считаем сделанным сразу.
  const availableDate = addDays(createDate, 14);
  return { availableDate, expectedReceiptDate: addBusinessDays(availableDate, 7) };
}

function isReturn(row: ScopedWbReportRow) {
  const value = String(row.doc_type_name ?? row.supplier_oper_name ?? "").toLocaleLowerCase("ru-RU");
  return value.includes("возврат") || value.includes("return");
}

function reportRowForPay(row: ScopedWbReportRow) {
  const amount = Number(row.ppvz_for_pay ?? 0) || 0;
  return isReturn(row) ? -amount : amount;
}

/**
 * Для общего seller точное «Итого» относится ко всем брендам. Распределяем
 * его по доле scoped-строк в «К перечислению», сохраняя итог и коэффициент
 * для аудита. Так общекабинетные удержания не теряются и не приписываются
 * нашим брендам целиком.
 */
export function calculateScopedWbCash(input: {
  snapshotDate: string;
  reports: readonly WbFinanceReportSummary[];
  rows: readonly ScopedWbReportRow[];
}): BalanceWbCashCalculation {
  const forPayByReport = new Map<string, number>();
  for (const row of input.rows) {
    const reportId = String(row.realizationreport_id ?? "").trim();
    if (!reportId) continue;
    forPayByReport.set(reportId, (forPayByReport.get(reportId) ?? 0) + reportRowForPay(row));
  }

  const lines: BalanceWbCashLine[] = [];
  const warnings: string[] = [];
  for (const report of input.reports) {
    if (report.periodTo >= input.snapshotDate) continue;
    const brandForPay = round2(forPayByReport.get(report.reportId) ?? 0);
    if (Math.abs(brandForPay) < 0.005) continue;
    const sellerForPay = report.forPaySum;
    const sellerTotal = report.bankPaymentSum;
    const rawShare = sellerForPay !== null && sellerForPay > 0 ? brandForPay / sellerForPay : null;
    const usableShare = rawShare !== null && rawShare >= 0 && rawShare <= 1.05 ? rawShare : null;
    if (rawShare !== null && usableShare === null) warnings.push(`Отчёт ${report.reportId}: доля бренда ${round2(rawShare * 100)}% некорректна, использована сумма строк`);
    if (sellerTotal === null || usableShare === null) warnings.push(`Отчёт ${report.reportId}: нет пригодного кабинетного итога, использована сумма строк`);
    const amount = round2(sellerTotal !== null && usableShare !== null ? sellerTotal * usableShare : brandForPay);
    const { availableDate, expectedReceiptDate } = wbReportSettlementDates(report);
    const state = expectedReceiptDate < input.snapshotDate
      ? "expected_in_bank"
      : availableDate <= input.snapshotDate ? "available" : "frozen";
    lines.push({
      reportId: report.reportId,
      periodFrom: report.periodFrom,
      periodTo: report.periodTo,
      availableDate,
      expectedReceiptDate,
      brandForPay,
      sellerForPay,
      sellerTotal,
      brandShare: usableShare === null ? null : round2(usableShare * 100) / 100,
      amount,
      state,
    });
  }
  const active = lines.filter((line) => line.state !== "expected_in_bank");
  return {
    amount: round2(active.reduce((sum, line) => sum + line.amount, 0)),
    availableAmount: round2(active.filter((line) => line.state === "available").reduce((sum, line) => sum + line.amount, 0)),
    lines,
    warnings,
  };
}
