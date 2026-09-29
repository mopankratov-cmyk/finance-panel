import assert from "node:assert/strict";
import test from "node:test";
import { calculateScopedWbCash, requiresScopedWbCash, scopedWbCashArticlePrefixes, scopedWbCashReportDates, wbReportSettlementDates } from "./balanceWbCash.ts";

test("Optima and Retail Family always use scoped cash calculation", () => {
  assert.equal(requiresScopedWbCash("Оптима — NORVIA / RIOBOX"), true);
  assert.equal(requiresScopedWbCash("Retail Family"), true);
  assert.equal(requiresScopedWbCash("CLERIN"), false);
});

test("shared sellers include only the configured owned-brand article prefixes", () => {
  assert.deepEqual(scopedWbCashArticlePrefixes("Retail Family"), ["NV-", "HT-"]);
  assert.deepEqual(scopedWbCashArticlePrefixes("Оптима — NORVIA / RIOBOX"), ["ESC", "NV-", "HT-"]);
  assert.deepEqual(scopedWbCashArticlePrefixes("CLERIN"), []);
});

test("scoped WB cash loads every report day once in chronological order", () => {
  assert.deepEqual(scopedWbCashReportDates([
    { periodFrom: "2026-09-07", periodTo: "2026-09-13" },
    { periodFrom: "2026-09-14", periodTo: "2026-09-15" },
  ]), [
    "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
    "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15",
  ]);
});

test("week 7-13 September is expected in the bank on 7 October", () => {
  assert.deepEqual(wbReportSettlementDates({ periodTo: "2026-09-13", createDate: "2026-09-14" }), {
    availableDate: "2026-09-28",
    expectedReceiptDate: "2026-10-07",
  });
});

test("calculates owned-brand net from detailed rows and keeps it frozen until bank date", () => {
  const result = calculateScopedWbCash({
    snapshotDate: "2026-10-01",
    reports: [{
      reportId: "77", periodFrom: "2026-09-07", periodTo: "2026-09-13", createDate: "2026-09-14",
      forPaySum: 1000, bankPaymentSum: 800, currency: "RUB",
    }],
    rows: [
      { realizationreport_id: 77, doc_type_name: "Продажа", supplier_oper_name: null, ppvz_for_pay: 300, delivery_rub: 20, storage_fee: 5, acceptance: 3, penalty: 2, deduction: 10, additional_payment: 4, cashback_discount: 2 },
      { realizationreport_id: 77, doc_type_name: "Возврат", supplier_oper_name: null, ppvz_for_pay: 50, delivery_rub: 0, storage_fee: 0, acceptance: 0, penalty: 0, deduction: 0, additional_payment: 0, cashback_discount: 0 },
    ],
  });
  assert.equal(result.amount, 216);
  assert.equal(result.availableAmount, 216);
  assert.equal(result.lines[0]?.brandShare, 0.25);
  assert.equal(result.lines[0]?.expectedReceiptDate, "2026-10-07");
});

test("does not keep a report in marketplace cash after expected bank receipt", () => {
  const result = calculateScopedWbCash({
    snapshotDate: "2026-10-08",
    reports: [{
      reportId: "77", periodFrom: "2026-09-07", periodTo: "2026-09-13", createDate: "2026-09-14",
      forPaySum: 1000, bankPaymentSum: 800, currency: "RUB",
    }],
    rows: [{ realizationreport_id: 77, doc_type_name: "Продажа", supplier_oper_name: null, ppvz_for_pay: 250, delivery_rub: 0, storage_fee: 0, acceptance: 0, penalty: 0, deduction: 0, additional_payment: 0, cashback_discount: 0 }],
  });
  assert.equal(result.amount, 0);
  assert.equal(result.lines[0]?.state, "expected_in_bank");
});
