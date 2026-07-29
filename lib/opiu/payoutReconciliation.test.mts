import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
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
  estimatedReceiptDate: "2026-07-31",
  state: "report_confirmed",
  ...overrides,
});

test("report identity survives provider corrections to period, amount and payout date", () => {
  const original = report();
  const correction = report({
    periodFrom: "2026-06-30",
    periodTo: "2026-07-08",
    amount: 110_000,
    estimatedReceiptDate: "2026-08-01",
  });

  assert.equal(payoutReportKey(original), payoutReportKey(correction));
  assert.deepEqual(upsertReports([original], [correction]), [correction]);
});

test("report identity isolates cabinets and companies", () => {
  const original = report();
  assert.notEqual(payoutReportKey(original), payoutReportKey(report({ cabinetId: "cabinet-b" })));
  assert.notEqual(payoutReportKey(original), payoutReportKey(report({ companyId: "company-b" })));
});

test("different reports on the same date remain separate", () => {
  const first = report({ reportId: "report-1" });
  const second = report({ reportId: "report-2" });

  assert.equal(upsertReports([], [first, second]).length, 2);
  assert.notEqual(payoutReportKey(first), payoutReportKey(second));
});

test("only valid links on done receipts count as bank facts", () => {
  const first = report({ reportId: "report-1", amount: 70_000 });
  const second = report({ reportId: "report-2", amount: 50_000 });
  const result = reconcileBankReceipts([first, second], [
    {
      id: "receipt-1",
      companyId: "company-a",
      amount: 120_000,
      status: "done",
      comment: `[payout-link:${payoutReportKey(first)}:70000] [payout-link:${payoutReportKey(second)}:50000]`,
    },
    {
      id: "receipt-planned",
      companyId: "company-a",
      amount: 70_000,
      status: "planned",
      comment: `[payout-link:${payoutReportKey(first)}:70000]`,
    },
  ]);

  assert.equal(result.receivedByReport.get(payoutReportKey(first)), 70_000);
  assert.equal(result.receivedByReport.get(payoutReportKey(second)), 50_000);
  assert.deepEqual(result.unresolved, []);
});

test("partial links, ambiguous receipts, over-allocation and duplicate receipt ids stay unresolved safely", () => {
  const first = report({ reportId: "report-1", amount: 100 });
  const second = report({ reportId: "report-2", amount: 100 });
  const result = reconcileBankReceipts([first, second], [
    { id: "ambiguous", companyId: "company-a", amount: 100, status: "done" },
    {
      id: "partial",
      companyId: "company-a",
      amount: 100,
      status: "done",
      comment: `[payout-link:${payoutReportKey(first)}:40]`,
    },
    {
      id: "over",
      companyId: "company-a",
      amount: 50,
      status: "done",
      comment: `[payout-link:${payoutReportKey(second)}:60]`,
    },
    {
      id: "partial",
      companyId: "company-a",
      amount: 100,
      status: "done",
      comment: `[payout-link:${payoutReportKey(first)}:100]`,
    },
  ]);

  assert.equal(result.receivedByReport.get(payoutReportKey(first)), 40);
  assert.equal(result.receivedByReport.has(payoutReportKey(second)), false);
  assert.deepEqual(result.unresolved, [
    { bankReceiptId: "ambiguous", reason: "ambiguous", amount: 100 },
    { bankReceiptId: "partial", reason: "partial", amount: 60 },
    { bankReceiptId: "over", reason: "over_allocation", amount: 10 },
  ]);
});

test("reconciliation never mutates done receipt rows", () => {
  const current = report();
  const receipt = {
    id: "receipt-1",
    companyId: "company-a",
    amount: 100_000,
    status: "done" as const,
    comment: `[payout-link:${payoutReportKey(current)}:100000]`,
  };
  const before = structuredClone(receipt);

  reconcileBankReceipts([current], [receipt]);

  assert.deepEqual(receipt, before);
});

test("payout links accept strict positive decimals and reject malformed money", () => {
  const current = report({ amount: 100 });
  const key = payoutReportKey(current);
  const malformed = [".", "1.2.3", "1e2", "Infinity", "NaN", "0", "-1"];

  for (const [index, amount] of malformed.entries()) {
    const result = reconcileBankReceipts([current], [{
      id: `bad-${index}`,
      companyId: "company-a",
      amount: 100,
      status: "done",
      comment: `[payout-link:${key}:${amount}]`,
    }]);
    assert.equal(result.receivedByReport.size, 0);
    assert.deepEqual(result.unresolved, [{
      bankReceiptId: `bad-${index}`,
      reason: "unlinked",
      amount: 100,
    }]);
    assert.doesNotMatch(JSON.stringify([...result.receivedByReport]), /NaN|Infinity/);
  }

  const valid = reconcileBankReceipts([current], [{
    id: "valid",
    companyId: "company-a",
    amount: 1.23,
    status: "done",
    comment: `[payout-link:${key}:1.23]`,
  }]);
  assert.equal(valid.receivedByReport.get(key), 1.23);

  const validFraction = reconcileBankReceipts([current], [{
    id: "valid-fraction",
    companyId: "company-a",
    amount: 0.1,
    status: "done",
    comment: `[payout-link:${key}:0.10]`,
  }]);
  assert.equal(validFraction.receivedByReport.get(key), 0.1);
});

test("Ozon forecast route is an authenticated read-only GET with fail-visible fields", () => {
  const source = readFileSync(
    new URL("../../app/api/opiu/ozon-forecast/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /export async function GET\(/);
  assert.match(source, /requireApiSession\(\["director", "finance"\]\)/);
  assert.match(source, /cabinetId/);
  assert.match(source, /companyId/);
  assert.match(source, /reportDataStatus/);
  assert.match(source, /forecastDataStatus/);
  assert.match(source, /plannedPositiveRevenueRows/);
  assert.match(source, /coveredPositiveRevenueRows/);
  assert.match(source, /actualDataStatus/);
  assert.match(source, /unallocatedForecastPayout/);
  assert.match(source, /reconciliationQueue/);
  assert.match(source, /loadBoundedPaymentRows/);
  assert.match(source, /loadOzonCashFlowReports/);
  assert.match(source, /reportBelongsToMonth/);
  assert.match(source, /parsePayoutMode/);
  assert.doesNotMatch(source, /NextResponse\.json\(\{\s*error:\s*(?:allCabinets|resolved)\.error/);
  assert.doesNotMatch(source, /error instanceof Error\s*\?\s*error\.message/);
  assert.doesNotMatch(source, /String\(error\)/);
  assert.doesNotMatch(source, /warnings\.push\([\s\S]{0,300}(?:error\.message|String\(error\))/);
  assert.doesNotMatch(source, /\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(source, /export async function (?:POST|PUT|PATCH|DELETE)\(/);
});

test("forecast panels and calendar wiring expose no publication or reconciliation mutation path", () => {
  const ozonPanel = readFileSync(
    new URL("../../components/calendar/OzonForecastPanel.tsx", import.meta.url),
    "utf8",
  );
  const wbPanel = readFileSync(
    new URL("../../components/calendar/SalesForecastPanel.tsx", import.meta.url),
    "utf8",
  );
  const calendarPage = readFileSync(
    new URL("../../components/calendar/CalendarPage.tsx", import.meta.url),
    "utf8",
  );
  const policy = readFileSync(
    new URL("./ozonForecastPolicy.ts", import.meta.url),
    "utf8",
  );
  const forbidden = /onAddPayment|onUpdatePayment|savePaymentWithCompany|updatePaymentCompany|calendarWrites|CalendarPlus/;

  assert.match(ozonPanel, /Только просмотр: ДДС и календарь не изменяются/);
  assert.match(ozonPanel, /result\.cabinetId === requestedCabinetId/);
  assert.match(ozonPanel, /data\?\.companyName \?\? "Определяется по кабинету"/);
  assert.doesNotMatch(ozonPanel, /query\.set\("company"/);
  assert.doesNotMatch(ozonPanel, /setCompanyId|requestedCompanyId/);
  assert.match(ozonPanel, /Ответ API не соответствует выбранному кабинету или компании/);
  assert.match(ozonPanel, /actualDataStatus === "degraded"/);
  assert.match(ozonPanel, /actualDataStatus === "not_started"/);
  assert.match(ozonPanel, /value=\{actualMetricsUnavailable \? "—"/);
  assert.match(ozonPanel, /forecastDataStatus === "degraded"/);
  assert.doesNotMatch(ozonPanel, /reportDataStatus === "not_selected"/);
  assert.match(ozonPanel, /formatNullableMoney/);
  assert.match(ozonPanel, /const controller = new AbortController\(\)/);
  assert.match(ozonPanel, /signal:\s*controller\.signal/);
  assert.match(ozonPanel, /controller\.abort\(\)/);
  assert.match(ozonPanel, /requestError instanceof DOMException[\s\S]*?requestError\.name === "AbortError"/);
  assert.match(
    ozonPanel,
    /Ответ API не соответствует[\s\S]*?setLoading\(false\)/,
  );
  assert.doesNotMatch(ozonPanel, forbidden);
  assert.doesNotMatch(ozonPanel, /<input[^>]+type=["'](?:date|number)["']/);
  assert.doesNotMatch(wbPanel, /onAddPayment|Payment|Перенести прогноз в платёжный календарь/);
  assert.match(wbPanel, /Только просмотр/);
  assert.match(
    calendarPage,
    /<SalesForecastPanel[\s\S]*?year=\{year\}[\s\S]*?month=\{month\}[\s\S]*?\/>/,
  );
  assert.match(
    calendarPage,
    /<OzonForecastPanel[\s\S]*?year=\{year\}[\s\S]*?month=\{month\}[\s\S]*?\/>/,
  );
  assert.doesNotMatch(
    calendarPage.match(/<SalesForecastPanel[\s\S]*?\/>/)?.[0] ?? "",
    /accounts|onAddPayment/,
  );
  assert.doesNotMatch(
    calendarPage.match(/<OzonForecastPanel[\s\S]*?\/>/)?.[0] ?? "",
    /payments|accounts|companyByPayment|onAdd|onUpdate/,
  );
  assert.doesNotMatch(policy, /\.(?:insert|update|upsert|delete)\s*\(/);
  assert.match(policy, /\.select\(/);
  assert.match(policy, /\.eq\("account_id", accountId\)/);
  assert.match(policy, /\.eq\("status", "done"\)/);
  assert.match(policy, /\.gt\("amount", 0\)/);
  assert.match(policy, /\.gte\("date", boundedFrom\)/);
  assert.match(policy, /\.lte\("date", boundedTo\)/);
  assert.match(policy, /\.order\("date"/);
  assert.match(policy, /\.order\("id"/);
  assert.match(policy, /\.range\(/);
});
