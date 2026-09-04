import assert from "node:assert/strict";
import test from "node:test";
import { publicStaffFields, spreadsheetDate, staffFromGrid } from "./staffSheet.ts";

const row = (over: Record<number, string>) => Array.from({ length: 26 }, (_, i) => over[i] ?? "");
const grid = [
  row({}), row({}),
  row({ 1: "Иванова Анна Петровна", 2: "официально", 3: "01.02.2025", 8: "Упаковщица", 12: "Москва", 14: "50 000", 17: "2200 1234 5678 9012", 24: "+79990000000" }),
  row({ 1: "Петров Пётр", 2: "самозанятый", 3: "2024-05-10", 6: "15.08.2026", 14: "70000", 17: "р/с 40817810000000000001 БИК 044525225" }),
  row({ 1: "", 14: "999" }),
];

test("статус — из даты увольнения в файле, а не из зашитых фамилий", () => {
  const staff = staffFromGrid(grid, [{ id: "c1", name: "ООО Ромашка" }]);
  assert.equal(staff.length, 2);
  assert.equal(staff[0].employmentStatus, "active");
  assert.equal(staff[1].employmentStatus, "terminated");
  assert.equal(staff[1].terminationDate, "2026-08-15");
  assert.equal(staff[1].employmentType, "self_employed");
  assert.equal(staff[1].defaultPaymentMethod, "bank_account");
  assert.equal(staff[0].monthlySalary, 50_000);
  assert.equal(staff[0].cardTransferDetails, "2200 1234 5678 9012");
  assert.equal(staff[1].settlementAccountDetails, "р/с 40817810000000000001 БИК 044525225");
  assert.equal(staff[0].paymentDetailsMasked, "•••• 9012");
});

test("серийная дата Excel читается как дата", () => {
  assert.equal(spreadsheetDate("46081"), "2026-02-28");
  assert.equal(spreadsheetDate("01.02.2025"), "2025-02-01");
  assert.equal(spreadsheetDate(""), null);
});

test("публичный вид сотрудника не содержит реквизитов и контактов", () => {
  const [employee] = staffFromGrid(grid);
  const pub = publicStaffFields(employee);
  assert.equal(pub.phone, "");
  assert.equal(pub.cardTransferDetails, "");
  assert.equal(pub.paymentDetails, "");
  assert.equal(pub.paymentDetailsMasked, "•••• 9012", "маска остаётся — она не раскрывает номер");
  assert.equal(pub.fullName, "Иванова Анна Петровна");
});
