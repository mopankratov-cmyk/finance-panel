"use client";

import type { PayrollAccrualLine, PayrollData, PayrollDebtOpening, PayrollDraftEntry, PayrollEmployee, PayrollEntry, PayrollPaymentAllocation, PayrollPeriod } from "./payroll";

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
  employmentDetails: String(row.employment_details ?? ""),
  hireDate: row.hire_date ? String(row.hire_date) : null,
  terminationDate: row.termination_date ? String(row.termination_date) : null,
  employerName: String(row.employer_name ?? ""),
  companyIds: Array.isArray(row.company_ids) ? row.company_ids.map(String) : (row.company_id ? [String(row.company_id)] : []),
  companyId: row.company_id ? String(row.company_id) : null,
  position: String(row.position ?? ""),
  project: String(row.project ?? ""),
  city: String(row.city ?? ""),
  workEmail: String(row.work_email ?? ""),
  birthDate: row.birth_date ? String(row.birth_date) : null,
  monthlySalary: Number(row.monthly_salary ?? 0),
  taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
  defaultPaymentMethod: row.default_payment_method as PayrollEmployee["defaultPaymentMethod"],
  bankName: String(row.bank_name ?? ""),
  phone: String(row.phone ?? ""),
  settlementAccountDetails: String(row.settlement_account_details ?? ""),
  cardTransferDetails: String(row.card_transfer_details ?? ""),
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
  lines: (Array.isArray(row.allocation_lines) ? row.allocation_lines : []).map((line) => {
    const item = line as Record<string, unknown>;
    return {
      id: String(item.id),
      kind: item.kind as PayrollAccrualLine["kind"],
      amount: Number(item.amount ?? 0),
      taxAmount: Number(item.taxAmount ?? 0),
      companyId: item.companyId ? String(item.companyId) : null,
      accountId: item.accountId ? String(item.accountId) : null,
      paymentMethod: item.paymentMethod as PayrollAccrualLine["paymentMethod"],
      salaryPaymentId: item.salaryPaymentId ? String(item.salaryPaymentId) : null,
      taxPaymentId: item.taxPaymentId ? String(item.taxPaymentId) : null,
      comment: String(item.comment ?? ""),
    };
  }),
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
  payrollLineId: row.payroll_line_id ? String(row.payroll_line_id) : null,
  debtOpeningId: row.debt_opening_id ? String(row.debt_opening_id) : null,
  amount: Number(row.amount ?? 0),
  allocationKind: row.allocation_kind as PayrollPaymentAllocation["allocationKind"],
  comment: String(row.comment ?? ""),
  confirmedBy: String(row.confirmed_by ?? ""),
  confirmedAt: String(row.confirmed_at),
});

export async function loadPayrollData(): Promise<PayrollData> {
  const [body, privateBody] = await Promise.all([
    fetch("/api/payroll", { cache: "no-store" }).then(json<{ employees?: Row[]; periods?: Row[]; entries?: Row[]; debts?: Row[]; allocations?: Row[]; preview?: boolean }>),
    fetch("/api/payroll/private", { cache: "no-store" }).then(async (response) => response.status === 403
      ? { privateRows: [] as Row[], canViewPrivate: false }
      : { ...(await json<{ privateRows?: Row[] }>(response)), canViewPrivate: true }),
  ]);
  const privateByEmployee = new Map((privateBody.privateRows ?? []).map((row) => [String(row.employee_id), row]));
  return {
    employees: (body.employees ?? []).map((row) => employeeFromRow({ ...row, ...(privateByEmployee.get(String(row.id)) ?? {}) })),
    periods: (body.periods ?? []).map(periodFromRow),
    entries: (body.entries ?? []).map(entryFromRow),
    debts: (body.debts ?? []).map(debtFromRow),
    allocations: (body.allocations ?? []).map(allocationFromRow),
    preview: body.preview === true,
    canViewPrivate: privateBody.canViewPrivate,
  };
}

export async function savePayrollDebt(employeeId: string, debtYear: number, amount: number, comment = ""): Promise<void> {
  await fetch("/api/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_debt", employeeId, debtYear, amount, comment }),
  }).then(json<{ debt: Row }>);
}

export async function importPayrollRequisites(records: Array<{ fullName: string; bankName: string; paymentDetails: string; settlementAccountDetails: string; cardTransferDetails: string; phone: string; workEmail: string; birthDate: string | null }>): Promise<number> {
  const result = await fetch("/api/payroll/private", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "import_private", records }),
  }).then(json<{ updated: number; skipped: number }>);
  return result.updated;
}

export async function allocatePayrollPayment(input: {
  paymentId: string;
  employeeId: string;
  entryId?: string;
  payrollLineId?: string;
  debtOpeningId?: string;
  amount: number;
  allocationKind: PayrollPaymentAllocation["allocationKind"];
  comment?: string;
}): Promise<void> {
  await fetch("/api/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "allocate_payment", ...input }),
  }).then(json<{ allocation: Row }>);
}

export async function savePayrollEmployee(employee: PayrollEmployee): Promise<void> {
  const result = await fetch("/api/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_employee", employee }),
  }).then(json<{ employee: Row }>);
  const employeeId = String(result.employee.id);
  const privateResponse = await fetch("/api/payroll/private", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_private", employeeId, private: employee }),
  });
  if (privateResponse.status !== 403) await json<{ ok: boolean }>(privateResponse);
}

/** Штатный Excel → сервер. preview=true — только разбор, без записи. Реквизиты — отдельно (importPayrollStaffPrivateFile). */
export async function importPayrollStaffFile(file: File, options: { preview: boolean }): Promise<{ preview: boolean; employees: PayrollEmployee[]; created: number; updated: number }> {
  const body = new FormData();
  body.append("action", "import_staff");
  body.append("preview", options.preview ? "1" : "0");
  body.append("file", file);
  return fetch("/api/payroll", { method: "POST", body }).then((response) => json<{ preview: boolean; employees: PayrollEmployee[]; created: number; updated: number }>(response));
}

/** Реквизиты и контакты из того же файла — только директор. */
export async function importPayrollStaffPrivateFile(file: File): Promise<{ updated: number; skipped: number }> {
  const body = new FormData();
  body.append("action", "import_staff_private");
  body.append("file", file);
  return fetch("/api/payroll/private", { method: "POST", body }).then((response) => json<{ updated: number; skipped: number }>(response));
}

export async function importPayrollEmployees(records: Array<Pick<PayrollEmployee, "fullName" | "employmentDetails" | "employmentType" | "hireDate" | "terminationDate" | "employerName" | "companyIds" | "companyId" | "position" | "project" | "city" | "monthlySalary" | "defaultPaymentMethod">>): Promise<number> {
  const result = await fetch("/api/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "import_employees", records }),
  }).then(json<{ updated: number; skipped: number }>);
  return result.updated;
}

export async function savePayrollPeriod(payDate: string, entries: PayrollDraftEntry[]): Promise<void> {
  await fetch("/api/payroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "save_period", payDate, entries }),
  }).then(json<{ ok: boolean }>);
}
