import assert from "node:assert/strict";
import test from "node:test";
import { fetchWbFinanceReportSummaries } from "./financeApi.ts";

test("financial report list keeps the exact seller total used for brand allocation", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const reports = await fetchWbFinanceReportSummaries("token", "2026-09-01", "2026-09-30", {
    retries: 0,
    fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify([{
        reportId: 42,
        dateFrom: "2026-09-07",
        dateTo: "2026-09-13",
        createDate: "2026-09-14",
        currency: "RUB",
        forPaySum: "1 000,50",
        bankPaymentSum: "800.40",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.period, "weekly");
  assert.deepEqual(reports, [{
    reportId: "42",
    periodFrom: "2026-09-07",
    periodTo: "2026-09-13",
    createDate: "2026-09-14",
    forPaySum: 1000.5,
    bankPaymentSum: 800.4,
    currency: "RUB",
  }]);
});
