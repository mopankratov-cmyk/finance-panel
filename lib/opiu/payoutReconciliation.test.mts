import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canWriteForecastToCalendar,
  payoutLinkMarker,
  payoutReportKey,
  reconcileBankReceipts,
  upsertReports,
  type PayoutReport,
} from "./payoutReconciliation";

const report = (overrides: Partial<PayoutReport> = {}): PayoutReport => ({
  marketplace: "ozon",
  cabinetId: "cabinet-a",
  companyId: "company-a",
  reportId: "report-1",
  periodFrom: "2026-07-01",
  periodTo: "2026-07-07",
  amount: 100_000,
  estimatedReceiptDate: "2026-07-29",
  state: "report_confirmed",
  ...overrides,
});

test("two cabinets of one company keep independent report identities", () => {
  assert.notEqual(payoutReportKey(report()), payoutReportKey(report({ cabinetId: "cabinet-b" })));
});

test("two reports on one date are not collapsed", () => {
  const rows = upsertReports([], [report(), report({ reportId: "report-2", periodFrom: "2026-07-08", periodTo: "2026-07-14" })]);
  assert.equal(rows.length, 2);
});

test("repeated sync is idempotent and a correction replaces the same report", () => {
  const first = upsertReports([], [report()]);
  const repeated = upsertReports(first, [report()]);
  const corrected = upsertReports(repeated, [report({ amount: 95_000 })]);
  assert.equal(repeated.length, 1);
  assert.equal(corrected.length, 1);
  assert.equal(corrected[0].amount, 95_000);
});

test("accrual or report amount is not bank receipt without a durable link", () => {
  const result = reconcileBankReceipts([report()], [{ id: "bank-1", companyId: "company-a", amount: 100_000, status: "done" }]);
  assert.equal(result.receivedByReport.size, 0);
  assert.deepEqual(result.unresolved, [{ bankReceiptId: "bank-1", reason: "unlinked", amount: 100_000 }]);
});

test("partial and combined bank receipts use explicit report allocations", () => {
  const first = report();
  const second = report({ reportId: "report-2", periodFrom: "2026-07-08", periodTo: "2026-07-14", amount: 60_000 });
  const combined = `${payoutLinkMarker(first, 70_000)} ${payoutLinkMarker(second, 50_000)}`;
  const result = reconcileBankReceipts([first, second], [{ id: "bank-1", companyId: "company-a", amount: 120_000, status: "done", comment: combined }]);
  assert.equal(result.receivedByReport.get(payoutReportKey(first)), 70_000);
  assert.equal(result.receivedByReport.get(payoutReportKey(second)), 50_000);
  assert.equal(result.unresolved.length, 0);
});

test("ambiguous equal receipts stay in manual queue and done facts are read only", () => {
  const rows = [report(), report({ cabinetId: "cabinet-b", reportId: "report-2" })];
  const result = reconcileBankReceipts(rows, [{ id: "bank-1", companyId: "company-a", amount: 100_000, status: "done" }]);
  assert.deepEqual(result.unresolved, [{ bankReceiptId: "bank-1", reason: "ambiguous", amount: 100_000 }]);
  assert.equal(rows[0].amount, 100_000);
});

test("working manager plan cannot be written to calendar", () => {
  assert.equal(canWriteForecastToCalendar("working_sales_plan", true), false);
  assert.equal(canWriteForecastToCalendar("approved_sales_plan", false), false);
  assert.equal(canWriteForecastToCalendar("approved_sales_plan", true), true);
});

test("duplicate receipt IDs are idempotent", () => {
  const current = report();
  const linked = payoutLinkMarker(current, 100_000);
  const result = reconcileBankReceipts([current], [
    { id: "same-bank-row", companyId: "company-a", amount: 100_000, status: "done", comment: linked },
    { id: "same-bank-row", companyId: "company-a", amount: 100_000, status: "done", comment: linked },
  ]);
  assert.equal(result.receivedByReport.get(payoutReportKey(current)), 100_000);
  assert.equal(result.unresolved.length, 0);
});

test("two distinct receipts cannot overpay one report", () => {
  const current = report();
  const result = reconcileBankReceipts([current], [
    { id: "bank-1", companyId: "company-a", amount: 80_000, status: "done", comment: payoutLinkMarker(current, 80_000) },
    { id: "bank-2", companyId: "company-a", amount: 80_000, status: "done", comment: payoutLinkMarker(current, 80_000) },
  ]);
  assert.equal(result.receivedByReport.get(payoutReportKey(current)), 100_000);
  assert.deepEqual(result.unresolved, [{ bankReceiptId: "bank-2", reason: "over_allocation", amount: 60_000 }]);
});

test("allocations greater than receipt are rejected instead of silently truncated", () => {
  const first = report();
  const second = report({ reportId: "report-2", periodFrom: "2026-07-08", periodTo: "2026-07-14", amount: 100_000 });
  const comment = `${payoutLinkMarker(first, 70_000)} ${payoutLinkMarker(second, 80_000)}`;
  const result = reconcileBankReceipts([first, second], [{ id: "bank-1", companyId: "company-a", amount: 120_000, status: "done", comment }]);
  assert.equal(result.receivedByReport.size, 0);
  assert.deepEqual(result.unresolved, [{ bankReceiptId: "bank-1", reason: "over_allocation", amount: 30_000 }]);
});

test("Ozon production route reads canonical company payments and fails visibly on query errors", () => {
  const source = readFileSync(new URL("../../app/api/opiu/ozon-forecast/route.ts", import.meta.url), "utf8");
  assert.match(source, /from\("payments"\)[\s\S]*\.eq\("company_id", companyId\)/);
  assert.doesNotMatch(source, /from\("finance_payments"\)/);
  assert.match(source, /if \(paymentError\) return NextResponse\.json/);
  assert.match(source, /reportDataStatus: "available" \| "degraded"/);
  assert.match(source, /page_count/);
});

test("degraded provider data preserves report rows and blocks calendar updates", () => {
  const route = readFileSync(new URL("../../app/api/opiu/ozon-forecast/route.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../components/calendar/OzonForecastPanel.tsx", import.meta.url), "utf8");
  assert.match(route, /Использован последний подтверждённый набор отчётов из платёжного календаря/);
  assert.match(panel, /data\.reportDataStatus === "degraded"/);
  assert.match(panel, /disabled=\{[^}]*data\.reportDataStatus === "degraded"/);
});

test("manual reconciliation writes durable links onto the existing done payment", () => {
  const panel = readFileSync(new URL("../../components/calendar/OzonForecastPanel.tsx", import.meta.url), "utf8");
  const calendar = readFileSync(new URL("../../components/calendar/CalendarPage.tsx", import.meta.url), "utf8");
  assert.match(panel, /row\.status === "done"/);
  assert.match(panel, /payoutLinkMarker\(report, amount\)/);
  assert.match(panel, /await onUpdatePayment\(\{ \.\.\.payment, comment:/);
  assert.doesNotMatch(panel, /onAddPayment\([\s\S]*?status:\s*"done"/);
  assert.match(calendar, /await savePaymentWithCompany\(payment, companyId\)/);
});

test("report correction updates date and amount of one identity with audit markers", () => {
  const panel = readFileSync(new URL("../../components/calendar/OzonForecastPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /comment\?\.includes\(itemMarker\)/);
  assert.match(panel, /\.\.\.previous, date: item\.date, amount: item\.amount/);
  assert.match(panel, /\[previous:\$\{previous\.date\}:\$\{previous\.amount\}\]/);
  assert.match(panel, /const duplicate = !item\.reportId/);
});

test("legacy WB plan and unconfirmed browser rules cannot write cabinet calendar", () => {
  const panel = readFileSync(new URL("../../components/calendar/SalesForecastPanel.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../app/api/opiu/forecast/route.ts", import.meta.url), "utf8");
  assert.match(panel, /data\?\.planSource !== "approved_sales_plan"/);
  assert.match(panel, /!payoutRulesConfirmed/);
  assert.doesNotMatch(route, /actualPayout:/);
  assert.doesNotMatch(panel, /payout-link:wb:/);
});
