import assert from "node:assert/strict";
import test from "node:test";
import {
  employeeBelongsToPeriod,
  isEmployeeActiveOn,
  payrollEntryTotal,
  payrollPeriodForDate,
  settlementFromAllocations,
  type PayrollDraftEntry,
  type PayrollEmployee,
  type PayrollEntry,
  type PayrollPeriod,
} from "./payroll.ts";

const employee: PayrollEmployee = {
  id: "employee-1",
  fullName: "Камалова Фаягуль Мансуровна",
  employmentStatus: "active",
  employmentType: "self_employed",
  hireDate: null,
  terminationDate: "2026-09-05",
  employerName: "ООО РИО",
  companyId: null,
  position: "Помощник финансиста",
  project: "",
  city: "",
  monthlySalary: 30_000,
  taxRate: null,
  defaultPaymentMethod: "bank_account",
  bankName: "",
  phone: "",
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

test("DDS payment reduces debt only after an explicit allocation", () => {
  const period: PayrollPeriod = { id: "period-1", payDate: "2026-09-05", periodStart: "2026-08-16", periodEnd: "2026-08-31", status: "planned" };
  const entry: PayrollEntry = { id: "entry-1", periodId: period.id, salaryPaymentId: "salary-plan", taxPaymentId: "tax-plan", ...draft };
  assert.equal(settlementFromAllocations(employee, entry, []).debt, 15_900);
  assert.deepEqual(settlementFromAllocations(employee, entry, [{
    id: "allocation-1",
    paymentId: "salary-fact",
    employeeId: employee.id,
    entryId: entry.id,
    debtOpeningId: null,
    amount: 10_000,
    allocationKind: "current_salary",
    comment: "",
    confirmedAt: "2026-09-05T10:00:00Z",
  }]), {
    salaryPaid: 10_000,
    taxPaid: 0,
    paid: 10_000,
    debt: 5_900,
    matchedPaymentIds: ["salary-fact"],
  });
});
