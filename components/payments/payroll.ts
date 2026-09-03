import type { Payment } from "@/lib/types";

export type PayrollEmploymentType = "official" | "unofficial" | "partial" | "individual_entrepreneur" | "self_employed";
export type PayrollPaymentMethod = "card" | "bank_account" | "cash";
export type PayrollEmploymentStatus = "active" | "terminated";
export type PayrollLineKind = "official" | "unofficial" | "contractor";

export interface PayrollAccrualLine {
  id: string;
  kind: PayrollLineKind;
  amount: number;
  taxAmount: number;
  companyId: string | null;
  accountId: string | null;
  paymentMethod: PayrollPaymentMethod;
  salaryPaymentId: string | null;
  taxPaymentId: string | null;
  comment: string;
}

export interface PayrollEmployee {
  id: string;
  fullName: string;
  employmentStatus: PayrollEmploymentStatus;
  employmentType: PayrollEmploymentType;
  /** Исходное описание трудоустройства из кадровой таблицы. */
  employmentDetails: string;
  hireDate: string | null;
  terminationDate: string | null;
  employerName: string;
  /** Все компании, на которые работает сотрудник. companyId остаётся основной. */
  companyIds: string[];
  companyId: string | null;
  position: string;
  project: string;
  city: string;
  workEmail: string;
  birthDate: string | null;
  monthlySalary: number;
  taxRate: number | null;
  defaultPaymentMethod: PayrollPaymentMethod;
  bankName: string;
  phone: string;
  settlementAccountDetails: string;
  cardTransferDetails: string;
  paymentDetails: string;
  paymentDetailsMasked: string;
  notes: string;
}

export interface PayrollPeriod {
  id: string;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "planned" | "paid";
}

export interface PayrollEntry {
  id: string;
  periodId: string;
  employeeId: string;
  officialAmount: number;
  unofficialAmount: number;
  contractorAmount: number;
  taxAmount: number;
  paymentMethod: PayrollPaymentMethod;
  companyId: string | null;
  accountId: string | null;
  salaryPaymentId: string | null;
  taxPaymentId: string | null;
  comment: string;
  lines: PayrollAccrualLine[];
}

export interface PayrollDraftEntry {
  employeeId: string;
  officialAmount: number;
  unofficialAmount: number;
  contractorAmount: number;
  taxAmount: number;
  paymentMethod: PayrollPaymentMethod;
  companyId: string | null;
  accountId: string | null;
  comment: string;
  lines: PayrollAccrualLine[];
}

export interface PayrollDebtOpening {
  id: string;
  employeeId: string;
  debtYear: number;
  amount: number;
  comment: string;
}

export interface PayrollPaymentAllocation {
  id: string;
  paymentId: string;
  employeeId: string;
  entryId: string | null;
  payrollLineId: string | null;
  debtOpeningId: string | null;
  amount: number;
  allocationKind: "current_salary" | "current_year_debt" | "prior_year_debt";
  comment: string;
  confirmedBy: string;
  confirmedAt: string;
}

export interface PayrollData {
  employees: PayrollEmployee[];
  periods: PayrollPeriod[];
  entries: PayrollEntry[];
  debts: PayrollDebtOpening[];
  allocations: PayrollPaymentAllocation[];
  preview?: boolean;
  canViewPrivate?: boolean;
}

export function allocatedToEntry(entryId: string, allocations: PayrollPaymentAllocation[]): number {
  return roundMoney(allocations.filter((item) => item.entryId === entryId).reduce((sum, item) => sum + item.amount, 0));
}

export function allocatedToDebt(debtId: string, allocations: PayrollPaymentAllocation[]): number {
  return roundMoney(allocations.filter((item) => item.debtOpeningId === debtId).reduce((sum, item) => sum + item.amount, 0));
}

export function settlementFromAllocations(
  employee: PayrollEmployee,
  entry: PayrollEntry,
  allocations: PayrollPaymentAllocation[],
): PayrollEntrySettlement {
  const total = payrollEntryTotal(employee, draftFromEntry(entry));
  const matching = allocations.filter((item) => item.entryId === entry.id);
  const paid = Math.min(total, roundMoney(matching.reduce((sum, item) => sum + item.amount, 0)));
  return {
    salaryPaid: paid,
    taxPaid: 0,
    paid,
    debt: Math.max(0, roundMoney(total - paid)),
    matchedPaymentIds: [...new Set(matching.map((item) => item.paymentId))],
  };
}

export const EMPLOYMENT_LABELS: Record<PayrollEmploymentType, string> = {
  official: "Официально",
  unofficial: "Неофициально",
  partial: "Частично официально",
  individual_entrepreneur: "ИП",
  self_employed: "Самозанятый",
};

export const PAYMENT_METHOD_LABELS: Record<PayrollPaymentMethod, string> = {
  card: "На карту",
  bank_account: "На расчётный счёт",
  cash: "Наличными",
};

const roundMoney = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

export function payrollPeriodForDate(payDate: string): { periodStart: string; periodEnd: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(payDate);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (day === 20) {
    return { periodStart: `${match[1]}-${match[2]}-01`, periodEnd: `${match[1]}-${match[2]}-15` };
  }
  if (day !== 5) return null;
  const previousMonth = new Date(Date.UTC(year, monthIndex, 0));
  const previousYear = previousMonth.getUTCFullYear();
  const previousMonthNumber = String(previousMonth.getUTCMonth() + 1).padStart(2, "0");
  const previousLastDay = String(previousMonth.getUTCDate()).padStart(2, "0");
  return {
    periodStart: `${previousYear}-${previousMonthNumber}-16`,
    periodEnd: `${previousYear}-${previousMonthNumber}-${previousLastDay}`,
  };
}

export function nextPayrollDate(today: string): string {
  const [year, month, day] = today.split("-").map(Number);
  if (day <= 5) return `${year}-${String(month).padStart(2, "0")}-05`;
  if (day <= 20) return `${year}-${String(month).padStart(2, "0")}-20`;
  const next = new Date(Date.UTC(year, month, 5));
  return next.toISOString().slice(0, 10);
}

export function isEmployeeActiveOn(employee: PayrollEmployee, date: string): boolean {
  return employee.employmentStatus === "active"
    && (!employee.hireDate || employee.hireDate <= date)
    && (!employee.terminationDate || employee.terminationDate > date);
}

export function employeeBelongsToPeriod(employee: PayrollEmployee, periodStart: string, periodEnd: string): boolean {
  if (employee.employmentStatus === "terminated" && !employee.terminationDate) return false;
  return (!employee.hireDate || employee.hireDate <= periodEnd)
    && (!employee.terminationDate || employee.terminationDate >= periodStart);
}

export function taxIsPayable(employee: PayrollEmployee, entry: Pick<PayrollDraftEntry, "paymentMethod">): boolean {
  if (employee.employmentType === "unofficial") return false;
  if (employee.employmentType === "individual_entrepreneur" || employee.employmentType === "self_employed") {
    return entry.paymentMethod === "bank_account";
  }
  return true;
}

/** Налог по строке: официальная часть всегда облагается, ИП/СЗ — только при выплате на р/с. */
export function payrollLineTaxIsPayable(
  employee: PayrollEmployee,
  line: Pick<PayrollAccrualLine, "kind" | "paymentMethod">,
): boolean {
  if (line.kind === "unofficial") return false;
  if (line.kind === "contractor"
    || employee.employmentType === "individual_entrepreneur"
    || employee.employmentType === "self_employed") {
    return line.paymentMethod === "bank_account";
  }
  return line.kind === "official";
}

export function payrollSalaryAmount(entry: Pick<PayrollDraftEntry, "officialAmount" | "unofficialAmount" | "contractorAmount"> & { lines?: PayrollAccrualLine[] }): number {
  if (entry.lines?.length) return roundMoney(entry.lines.reduce((sum, line) => sum + line.amount, 0));
  return roundMoney(entry.officialAmount + entry.unofficialAmount + entry.contractorAmount);
}

export function payrollTaxAmount(employee: PayrollEmployee, entry: PayrollDraftEntry): number {
  if (entry.lines.length) return roundMoney(entry.lines.reduce((sum, line) => sum + (payrollLineTaxIsPayable(employee, line) ? line.taxAmount : 0), 0));
  return taxIsPayable(employee, entry) ? roundMoney(entry.taxAmount) : 0;
}

export function payrollEntryTotal(employee: PayrollEmployee, entry: PayrollDraftEntry): number {
  return roundMoney(payrollSalaryAmount(entry) + payrollTaxAmount(employee, entry));
}

export function blankPayrollEntry(employee: PayrollEmployee): PayrollDraftEntry {
  const makeLine = (kind: PayrollLineKind, paymentMethod: PayrollPaymentMethod): PayrollAccrualLine => ({
    id: crypto.randomUUID(), kind, amount: 0, taxAmount: 0, companyId: employee.companyId,
    accountId: null, paymentMethod, salaryPaymentId: null, taxPaymentId: null, comment: "",
  });
  const lines = employee.employmentType === "partial"
    ? [makeLine("official", "bank_account"), makeLine("unofficial", "card")]
    : employee.employmentType === "official"
      ? [makeLine("official", employee.defaultPaymentMethod)]
      : employee.employmentType === "unofficial"
        ? [makeLine("unofficial", employee.defaultPaymentMethod)]
        : [makeLine("contractor", employee.defaultPaymentMethod)];
  return {
    employeeId: employee.id,
    officialAmount: 0,
    unofficialAmount: 0,
    contractorAmount: 0,
    taxAmount: 0,
    paymentMethod: employee.defaultPaymentMethod,
    companyId: employee.companyId,
    accountId: null,
    comment: "",
    lines,
  };
}

export function draftFromEntry(entry: PayrollEntry): PayrollDraftEntry {
  return {
    employeeId: entry.employeeId,
    officialAmount: entry.officialAmount,
    unofficialAmount: entry.unofficialAmount,
    contractorAmount: entry.contractorAmount,
    taxAmount: entry.taxAmount,
    paymentMethod: entry.paymentMethod,
    companyId: entry.companyId,
    accountId: entry.accountId,
    comment: entry.comment,
    lines: entry.lines?.length ? entry.lines : [],
  };
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
}

function surname(fullName: string): string {
  return normalized(fullName).split(" ")[0] ?? "";
}

export interface PayrollEntrySettlement {
  salaryPaid: number;
  taxPaid: number;
  paid: number;
  debt: number;
  matchedPaymentIds: string[];
}

export function reconcilePayrollEntry(
  employee: PayrollEmployee,
  period: PayrollPeriod,
  entry: PayrollEntry,
  payments: Payment[],
): PayrollEntrySettlement {
  const draft = draftFromEntry(entry);
  const salaryDue = payrollSalaryAmount(draft);
  const taxDue = payrollTaxAmount(employee, draft);
  const employeeSurname = surname(employee.fullName);
  const windowEnd = new Date(`${period.payDate}T00:00:00Z`);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 45);
  const lastDate = windowEnd.toISOString().slice(0, 10);
  const candidates = payments.filter((payment) => {
    if (payment.status !== "done" || payment.amount >= 0 || payment.date < period.periodStart || payment.date > lastDate) return false;
    const text = normalized(`${payment.counterparty} ${payment.name} ${payment.category} ${payment.comment ?? ""}`);
    const direct = text.includes(normalized(`payroll-entry-${entry.id}`)) || payment.comment?.includes(`[payroll-entry:${entry.id}]`);
    return direct || Boolean(employeeSurname && text.includes(employeeSurname));
  });
  const salaryCandidates = candidates.filter((payment) => !/(налог|ндфл|взнос|фнс)/.test(normalized(`${payment.name} ${payment.category} ${payment.comment ?? ""}`)));
  const taxCandidates = candidates.filter((payment) => /(налог|ндфл|взнос|фнс)/.test(normalized(`${payment.name} ${payment.category} ${payment.comment ?? ""}`)));
  const salaryPaid = Math.min(salaryDue, roundMoney(salaryCandidates.reduce((sum, payment) => sum + Math.abs(payment.amount), 0)));
  const taxPaid = Math.min(taxDue, roundMoney(taxCandidates.reduce((sum, payment) => sum + Math.abs(payment.amount), 0)));
  const paid = roundMoney(salaryPaid + taxPaid);
  return {
    salaryPaid,
    taxPaid,
    paid,
    debt: Math.max(0, roundMoney(salaryDue + taxDue - paid)),
    matchedPaymentIds: [...salaryCandidates, ...taxCandidates].map((payment) => payment.id),
  };
}

export function reconcilePayrollLedger(
  employees: PayrollEmployee[],
  periods: PayrollPeriod[],
  entries: PayrollEntry[],
  payments: Payment[],
): Map<string, PayrollEntrySettlement> {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const available = new Map(
    payments
      .filter((payment) => payment.status === "done" && payment.amount < 0)
      .map((payment) => [payment.id, Math.abs(payment.amount)]),
  );
  const result = new Map<string, PayrollEntrySettlement>();
  const ordered = [...entries].sort((left, right) => {
    const leftDate = periodById.get(left.periodId)?.payDate ?? "";
    const rightDate = periodById.get(right.periodId)?.payDate ?? "";
    return leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id);
  });

  for (const entry of ordered) {
    const employee = employeeById.get(entry.employeeId);
    const period = periodById.get(entry.periodId);
    if (!employee || !period) continue;
    const draft = draftFromEntry(entry);
    let salaryRemaining = payrollSalaryAmount(draft);
    let taxRemaining = payrollTaxAmount(employee, draft);
    let salaryPaid = 0;
    let taxPaid = 0;
    const matchedPaymentIds: string[] = [];
    const employeeSurname = surname(employee.fullName);
    const windowEnd = new Date(`${period.payDate}T00:00:00Z`);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + 45);
    const lastDate = windowEnd.toISOString().slice(0, 10);
    const candidates = payments
      .filter((payment) => {
        const left = available.get(payment.id) ?? 0;
        if (left <= 0 || payment.status !== "done" || payment.amount >= 0) return false;
        const direct = payment.comment?.includes(`[payroll-entry:${entry.id}]`) ?? false;
        if (direct) return true;
        if (payment.date < period.periodStart || payment.date > lastDate) return false;
        return Boolean(employeeSurname && normalized(`${payment.counterparty} ${payment.name} ${payment.comment ?? ""}`).includes(employeeSurname));
      })
      .sort((left, right) => {
        const leftDirect = left.comment?.includes(`[payroll-entry:${entry.id}]`) ? 0 : 1;
        const rightDirect = right.comment?.includes(`[payroll-entry:${entry.id}]`) ? 0 : 1;
        return leftDirect - rightDirect || left.date.localeCompare(right.date);
      });
    for (const payment of candidates) {
      const left = available.get(payment.id) ?? 0;
      if (left <= 0) continue;
      const isTax = /(налог|ндфл|взнос|фнс)/.test(normalized(`${payment.name} ${payment.category} ${payment.comment ?? ""}`));
      const needed = isTax ? taxRemaining : salaryRemaining;
      if (needed <= 0) continue;
      const applied = Math.min(left, needed);
      available.set(payment.id, roundMoney(left - applied));
      if (isTax) {
        taxRemaining = roundMoney(taxRemaining - applied);
        taxPaid = roundMoney(taxPaid + applied);
      } else {
        salaryRemaining = roundMoney(salaryRemaining - applied);
        salaryPaid = roundMoney(salaryPaid + applied);
      }
      matchedPaymentIds.push(payment.id);
    }
    const paid = roundMoney(salaryPaid + taxPaid);
    result.set(entry.id, {
      salaryPaid,
      taxPaid,
      paid,
      debt: roundMoney(salaryRemaining + taxRemaining),
      matchedPaymentIds,
    });
  }
  return result;
}
