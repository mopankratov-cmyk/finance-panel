import assert from "node:assert/strict";
import test from "node:test";
import {
  blankPayrollEntry,
  employeeBelongsToPeriod,
  isEmployeeActiveOn,
  payrollEntryTotal,
  payrollDebtByYear,
  payrollLineTaxIsPayable,
  payrollPeriodForDate,
  payrollSalaryAmount,
  settlementFromAllocations,
  type PayrollDraftEntry,
  type PayrollEmployee,
  type PayrollEntry,
  type PayrollData,
  type PayrollPeriod,
} from "./payroll.ts";

const employee: PayrollEmployee = {
  id: "employee-1",
  fullName: "Камалова Фаягуль Мансуровна",
  employmentStatus: "active",
  employmentType: "self_employed",
  employmentDetails: "Самозанятость ООО РИО",
  hireDate: null,
  terminationDate: "2026-09-05",
  employerName: "ООО РИО",
  companyIds: [],
  companyId: null,
  position: "Помощник финансиста",
  project: "",
  city: "",
  workEmail: "",
  birthDate: null,
  monthlySalary: 30_000,
  taxRate: null,
  defaultPaymentMethod: "bank_account",
  bankName: "",
  phone: "",
  settlementAccountDetails: "",
  cardTransferDetails: "",
  paymentDetails: "",
  paymentDetailsMasked: "",
  notes: "",
};

const draft: PayrollDraftEntry = {
  employeeId: employee.id,
  officialAmount: 0,
  unofficialAmount: 0,
  contractorAmount: 15_000,
  taxAmount: 900,
  paymentMethod: "bank_account",
  companyId: null,
  accountId: "account-1",
  comment: "",
  lines: [],
};

test("payroll dates produce the correct half-month periods", () => {
  assert.deepEqual(payrollPeriodForDate("2026-09-05"), { periodStart: "2026-08-16", periodEnd: "2026-08-31" });
  assert.deepEqual(payrollPeriodForDate("2026-09-20"), { periodStart: "2026-09-01", periodEnd: "2026-09-15" });
  assert.equal(payrollPeriodForDate("2026-09-10"), null);
});

test("employee moves to former list on termination date but remains in earned period", () => {
  assert.equal(isEmployeeActiveOn(employee, "2026-09-04"), true);
  assert.equal(isEmployeeActiveOn(employee, "2026-09-05"), false);
  assert.equal(employeeBelongsToPeriod(employee, "2026-09-01", "2026-09-15"), true);
});

test("terminated employee without a date stays out of a new payroll period", () => {
  const former = { ...employee, employmentStatus: "terminated" as const, terminationDate: null };
  assert.equal(isEmployeeActiveOn(former, "2026-09-02"), false);
  assert.equal(employeeBelongsToPeriod(former, "2026-08-16", "2026-08-31"), false);
});

test("contractor tax is added for bank account and removed for cash", () => {
  assert.equal(payrollEntryTotal(employee, draft), 15_900);
  assert.equal(payrollEntryTotal(employee, { ...draft, paymentMethod: "cash" }), 15_000);
});

test("tax column is active for official salary and bank payments to IP or self-employed", () => {
  const official = { ...employee, employmentType: "official" as const };
  assert.equal(payrollLineTaxIsPayable(official, { kind: "official", paymentMethod: "card" }), true);
  assert.equal(payrollLineTaxIsPayable(employee, { kind: "contractor", paymentMethod: "bank_account" }), true);
  assert.equal(payrollLineTaxIsPayable(employee, { kind: "contractor", paymentMethod: "cash" }), false);
  assert.equal(payrollLineTaxIsPayable(official, { kind: "unofficial", paymentMethod: "card" }), false);
});

test("partially official employee starts with separate official and card accruals", () => {
  const partial = blankPayrollEntry({ ...employee, employmentType: "partial" });
  assert.deepEqual(partial.lines.map((line) => [line.kind, line.paymentMethod]), [
    ["official", "bank_account"],
    ["unofficial", "card"],
  ]);
});

test("salary is summed across different companies and payment methods", () => {
  const split = {
    ...draft,
    lines: [
      { id: "rio", kind: "contractor" as const, amount: 40_000, taxAmount: 2_400, companyId: "rio", accountId: "wallet-rio", paymentMethod: "bank_account" as const, salaryPaymentId: null, taxPaymentId: null, comment: "РИО" },
      { id: "filippova", kind: "contractor" as const, amount: 10_000, taxAmount: 0, companyId: "filippova", accountId: "wallet-filippova", paymentMethod: "cash" as const, salaryPaymentId: null, taxPaymentId: null, comment: "Филиппова" },
    ],
  };
  assert.equal(payrollSalaryAmount(split), 50_000);
  assert.equal(payrollEntryTotal(employee, split), 52_400);
});

test("DDS payment reduces debt only after an explicit allocation", () => {
  const period: PayrollPeriod = { id: "period-1", payDate: "2026-09-05", periodStart: "2026-08-16", periodEnd: "2026-08-31", status: "planned" };
  const entry: PayrollEntry = { id: "entry-1", periodId: period.id, salaryPaymentId: "salary-plan", taxPaymentId: "tax-plan", ...draft };
  assert.equal(settlementFromAllocations(employee, entry, []).debt, 15_900);
  assert.deepEqual(settlementFromAllocations(employee, entry, [{
    id: "allocation-1",
    paymentId: "salary-fact",
    employeeId: employee.id,
    entryId: entry.id,
    payrollLineId: null,
    debtOpeningId: null,
    amount: 10_000,
    allocationKind: "current_salary",
    comment: "",
    confirmedBy: "finance@example.com",
    confirmedAt: "2026-09-05T10:00:00Z",
  }]), {
    salaryPaid: 10_000,
    taxPaid: 0,
    paid: 10_000,
    debt: 5_900,
    matchedPaymentIds: ["salary-fact"],
  });
});

test("долг в своде разделяется по году ведомости и году начального долга", () => {
  const periods: PayrollPeriod[] = [
    { id: "period-2025", payDate: "2025-12-20", periodStart: "2025-12-01", periodEnd: "2025-12-15", status: "paid" },
    { id: "period-2026", payDate: "2026-01-05", periodStart: "2025-12-16", periodEnd: "2025-12-31", status: "paid" },
  ];
  const entries: PayrollEntry[] = [
    { id: "entry-2025", periodId: "period-2025", salaryPaymentId: null, taxPaymentId: null, ...draft },
    { id: "entry-2026", periodId: "period-2026", salaryPaymentId: null, taxPaymentId: null, ...draft },
  ];
  const data: PayrollData = {
    employees: [employee], periods, entries,
    debts: [{ id: "opening-2026", employeeId: employee.id, debtYear: 2026, amount: 20_000, comment: "" }],
    allocations: [
      { id: "entry-payment", paymentId: "payment-1", employeeId: employee.id, entryId: "entry-2025", payrollLineId: null, debtOpeningId: null, amount: 5_900, allocationKind: "prior_year_debt", comment: "", confirmedBy: "", confirmedAt: "2026-01-01T00:00:00Z" },
      { id: "opening-payment", paymentId: "payment-2", employeeId: employee.id, entryId: null, payrollLineId: null, debtOpeningId: "opening-2026", amount: 2_000, allocationKind: "current_year_debt", comment: "", confirmedBy: "", confirmedAt: "2026-01-01T00:00:00Z" },
    ],
  };
  assert.deepEqual([...payrollDebtByYear(data)], [[2025, 10_000], [2026, 33_900]]);
});
