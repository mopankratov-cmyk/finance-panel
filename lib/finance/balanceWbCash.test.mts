import assert from "node:assert/strict";
import test from "node:test";
import { calculateScopedWbCash, wbReportSettlementDates } from "./balanceWbCash.ts";

test("week 7-13 September is expected in the bank on 7 October", () => {
  assert.deepEqual(wbReportSettlementDates({ periodTo: "2026-09-13", createDate: "2026-09-14" }), {
    availableDate: "2026-09-28",
    expectedReceiptDate: "2026-10-07",
  });
});

test("allocates exact seller total to own brands and keeps it frozen until bank date", () => {
  const result = calculateScopedWbCash({
    snapshotDate: "2026-10-01",
    reports: [{
      reportId: "77", periodFrom: "2026-09-07", periodTo: "2026-09-13", createDate: "2026-09-14",
      forPaySum: 1000, bankPaymentSum: 800, currency: "RUB",
    }],
    rows: [
      { realizationreport_id: 77, doc_type_name: "Продажа", supplier_oper_name: null, ppvz_for_pay: 300 },
      { realizationreport_id: 77, doc_type_name: "Возврат", supplier_oper_name: null, ppvz_for_pay: 50 },
    ],
  });
  assert.equal(result.amount, 200);
  assert.equal(result.availableAmount, 200);
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
    rows: [{ realizationreport_id: 77, doc_type_name: "Продажа", supplier_oper_name: null, ppvz_for_pay: 250 }],
  });
  assert.equal(result.amount, 0);
  assert.equal(result.lines[0]?.state, "expected_in_bank");
});
