"use client";

import type { PayrollData, PayrollDebtOpening, PayrollDraftEntry, PayrollEmployee, PayrollEntry, PayrollPaymentAllocation, PayrollPeriod } from "./payroll";

type Row = Record<string, unknown>;

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

const employeeFromRow = (row: Row): PayrollEmployee => ({
  id: String(row.id),
  fullName: String(row.full_name),
  employmentStatus: row.employment_status === "terminated" ? "terminated" : "active",
  employmentType: row.employment_type as PayrollEmployee["employmentType"],
  hireDate: row.hire_date ? String(row.hire_date) : null,
  terminationDate: row.termination_date ? String(row.termination_date) : null,
  employerName: String(row.employer_name ?? ""),
  companyId: row.company_id ? String(row.company_id) : null,
  position: String(row.position ?? ""),
  project: String(row.project ?? ""),
  city: String(row.city ?? ""),
  monthlySalary: Number(row.monthly_salary ?? 0),
  taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
  defaultPaymentMethod: row.default_payment_method as PayrollEmployee["defaultPaymentMethod"],
  bankName: String(row.bank_name ?? ""),
  phone: String(row.phone ?? ""),
  paymentDetails: String(row.payment_details ?? ""),
  paymentDetailsMasked: String(row.payment_details_masked ?? ""),
  notes: String(row.notes ?? ""),
});

const periodFromRow = (row: Row): PayrollPeriod => ({
  id: String(row.id),
  payDate: String(row.pay_date),
  periodStart: String(row.period_start),
  periodEnd: String(row.period_end),
  status: row.status as PayrollPeriod["status"],
});

const entryFromRow = (row: Row): PayrollEntry => ({
  id: String(row.id),
  periodId: String(row.period_id),
  employeeId: String(row.employee_id),
  officialAmount: Number(row.official_amount ?? 0),
  unofficialAmount: Number(row.unofficial_amount ?? 0),
  contractorAmount: Number(row.contractor_amount ?? 0),
  taxAmount: Number(row.tax_amount ?? 0),
  paymentMethod: row.payment_method as PayrollEntry["paymentMethod"],
  companyId: row.company_id ? String(row.company_id) : null,
  accountId: row.account_id ? String(row.account_id) : null,
  salaryPaymentId: row.salary_payment_id ? String(row.salary_payment_id) : null,
  taxPaymentId: row.tax_payment_id ? String(row.tax_payment_id) : null,
  comment: String(row.comment ?? ""),
});

const debtFromRow = (row: Row): PayrollDebtOpening => ({
  id: String(row.id),
  employeeId: String(row.employee_id),
  debtYear: Number(row.debt_year),
  amount: Number(row.amount ?? 0),
  comment: String(row.comment ?? ""),
});

const allocationFromRow = (row: Row): PayrollPaymentAllocation => ({
  id: String(row.id),
  paymentId: String(row.payment_id),
  employeeId: String(row.employee_id),
  entryId: row.entry_id ? String(row.entry_id) : null,
  debtOpeningId: row.debt_opening_id ? String(row.debt_opening_id) : null,
  amount: Number(row.amount ?? 0),
  allocationKind: row.allocation_kind as PayrollPaymentAllocation["allocationKind"],
  comment: String(row.comment ?? ""),
  confirmedAt: String(row.confirmed_at),
});

export async function loadPayrollData(): Promise<PayrollData> {
  const body = await fetch("/api/finance/payroll", { cache: "no-store" }).then(json<{ employees?: Row[]; periods?: Row[]; entries?: Row[]; debts?: Row[]; allocations?: Row[]; preview?: boolean }>);
  return {
    employees: (body.employees ?? []).map(employeeFromRow),
    periods: (body.periods ?? []).map(periodFromRow),
    entries: (body.entries ?? []).map(entryFromRow),
    debts: (body.debts ?? []).map(debtFromRow),
    allocations: (body.allocations ?? []).map(allocationFromRow),
    preview: body.preview === true,
  };
}

export async function savePayrollDebt(employeeId: string, debtYear: number, amount: number, comment = ""): Promise<void> {
  await fetch("/api/finance/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_debt", employeeId, debtYear, amount, comment }),
  }).then(json<{ debt: Row }>);
}

export async function importPayrollRequisites(records: Array<{ fullName: string; bankName: string; paymentDetails: string; phone: string }>): Promise<number> {
  const result = await fetch("/api/finance/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "import_requisites", records }),
  }).then(json<{ updated: number }>);
  return result.updated;
}

export async function allocatePayrollPayment(input: {
  paymentId: string;
  employeeId: string;
  entryId?: string;
  debtOpeningId?: string;
  amount: number;
  allocationKind: PayrollPaymentAllocation["allocationKind"];
  comment?: string;
}): Promise<void> {
  await fetch("/api/finance/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "allocate_payment", ...input }),
  }).then(json<{ allocation: Row }>);
}

export async function savePayrollEmployee(employee: PayrollEmployee): Promise<void> {
  await fetch("/api/finance/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_employee", employee }),
  }).then(json<{ employee: Row }>);
}

export async function savePayrollPeriod(payDate: string, entries: PayrollDraftEntry[]): Promise<void> {
  await fetch("/api/finance/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_period", payDate, entries }),
  }).then(json<{ ok: boolean }>);
}
