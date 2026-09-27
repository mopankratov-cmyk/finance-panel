import type { WbFinanceReportSummary } from "@/lib/wb/financeApi";

export interface ScopedWbReportRow {
  realizationreport_id: number | string | null;
  doc_type_name: string | null;
  supplier_oper_name: string | null;
  ppvz_for_pay: number | null;
  delivery_rub: number | null;
  storage_fee: number | null;
  acceptance: number | null;
  penalty: number | null;
  deduction: number | null;
  additional_payment: number | null;
  cashback_discount: number | null;
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

/** Эти seller-кабинеты содержат чужие бренды, даже если они не заведены в панели отдельными targets. */
export function requiresScopedWbCash(cabinetName: unknown) {
  const name = String(cabinetName ?? "").normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]+/gi, "");
  return name.includes("optima") || name.includes("оптима") || name.includes("retailfamily") || name.includes("ритейлфэмили") || name.includes("ритейлфемили");
}

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
 * Общий seller-level «Итого» нельзя пропорционально делить: общекабинетные
 * удержания способны сделать базу распределения близкой к нулю и многократно
 * раздуть долю бренда. Поэтому считаем собственное «Итого» прямо по
 * детальным строкам наших SKU: к перечислению минус привязанные расходы
 * плюс выплаты/компенсации. Обезличенные удержания чужих брендов сюда не
 * попадают.
 */
export function calculateScopedWbCash(input: {
  snapshotDate: string;
  reports: readonly WbFinanceReportSummary[];
  rows: readonly ScopedWbReportRow[];
}): BalanceWbCashCalculation {
  const forPayByReport = new Map<string, number>();
  const netByReport = new Map<string, number>();
  for (const row of input.rows) {
    const reportId = String(row.realizationreport_id ?? "").trim();
    if (!reportId) continue;
    const forPay = reportRowForPay(row);
    const expenses = Number(row.delivery_rub ?? 0)
      + Number(row.storage_fee ?? 0)
      + Number(row.acceptance ?? 0)
      + Number(row.penalty ?? 0)
      + Number(row.deduction ?? 0);
    const compensations = Number(row.additional_payment ?? 0) + Number(row.cashback_discount ?? 0);
    forPayByReport.set(reportId, (forPayByReport.get(reportId) ?? 0) + forPay);
    netByReport.set(reportId, (netByReport.get(reportId) ?? 0) + forPay - expenses + compensations);
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
    const amount = round2(netByReport.get(report.reportId) ?? brandForPay);
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
