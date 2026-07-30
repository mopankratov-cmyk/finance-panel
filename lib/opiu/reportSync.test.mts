import assert from "node:assert/strict";
import test from "node:test";
import {
  opiuReportMonthPeriod,
  opiuReportRefreshPeriod,
} from "./reportSync";

test("manual OPIU report periods cover the exact calendar month", () => {
  assert.deepEqual(opiuReportMonthPeriod("2026-02"), {
    dateFrom: "2026-02-01",
    dateTo: "2026-02-28",
  });
  assert.deepEqual(opiuReportMonthPeriod("2028-02"), {
    dateFrom: "2028-02-01",
    dateTo: "2028-02-29",
  });
  assert.equal(opiuReportMonthPeriod("2026-13"), null);
  assert.equal(opiuReportMonthPeriod("July"), null);
});

test("daily OPIU refresh includes previous month corrections in Moscow time", () => {
  assert.deepEqual(
    opiuReportRefreshPeriod(new Date("2026-07-30T05:00:00.000Z")),
    { dateFrom: "2026-06-01", dateTo: "2026-07-30" },
  );
  assert.deepEqual(
    opiuReportRefreshPeriod(new Date("2026-12-31T21:30:00.000Z")),
    { dateFrom: "2026-12-01", dateTo: "2027-01-01" },
  );
});
