import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWbFinanceReports, optionalMoney, strictWbPaymentDate } from "./wbPayoutStatus";

test("WB payment date is accepted only when an exact valid date is present", () => {
  assert.equal(strictWbPaymentDate("2026-08-31T00:00:00Z"), "2026-08-31");
  assert.equal(strictWbPaymentDate("-1"), null);
  assert.equal(strictWbPaymentDate("31.08.2026"), null);
  assert.equal(strictWbPaymentDate("2026-02-31"), null);
});

test("WB money parser keeps zero but rejects invalid values", () => {
  assert.equal(optionalMoney("1 234,56"), 1234.56);
  assert.equal(optionalMoney(0), 0);
  assert.equal(optionalMoney(-1), null);
  assert.equal(optionalMoney("unknown"), null);
});

test("report fields remain diagnostic and are never converted into a scheduled withdrawal", () => {
  const reports = normalizeWbFinanceReports({ data: [
    { reportId: 11, dateFrom: "2026-08-01", dateTo: "2026-08-07", forPaySum: 1000, paymentSchedule: "-1" },
    { reportId: 12, dateFrom: "2026-08-08", dateTo: "2026-08-14", forPaySum: 2000, bankPaymentSum: 1900, paymentSchedule: "2026-08-29T00:00:00Z" },
  ] });
  assert.equal(reports.length, 2);
  assert.deepEqual(reports, [
    { reportId: "11", periodFrom: "2026-08-01", periodTo: "2026-08-07", forPaySum: 1000, bankPaymentSum: null, paymentSchedule: "-1" },
    { reportId: "12", periodFrom: "2026-08-08", periodTo: "2026-08-14", forPaySum: 2000, bankPaymentSum: 1900, paymentSchedule: "2026-08-29T00:00:00Z" },
  ]);
});
