import assert from "node:assert/strict";
import test from "node:test";
import { browserPayoutKey, browserPayoutsByScheduleId, normalizeBrowserPayoutSnapshot, resolveBrowserPayoutReportId, upsertBrowserPayoutSnapshot } from "./browserPayoutSnapshots";
import { payoutReportKey } from "./payoutReconciliation";

const snapshot = (overrides = {}) => normalizeBrowserPayoutSnapshot({
  marketplace: "wb",
  cabinetId: "cabinet-a",
  companyId: "company-a",
  accountId: "account-a",
  externalId: "withdrawal-1",
  reportId: "report-1",
  periodFrom: "2026-08-01",
  periodTo: "2026-08-07",
  plannedDate: "2026-08-21",
  amount: 1234.56,
  state: "awaiting_transfer",
  capturedAt: "2026-08-19T12:00:00Z",
  ...overrides,
});

test("browser payout identity isolates marketplace, cabinet and provider row", () => {
  const row = snapshot();
  assert.ok(row);
  assert.equal(browserPayoutKey(row), "wb:cabinet-a:withdrawal-1");
});

test("provider correction replaces the same payout instead of creating a duplicate", () => {
  const original = snapshot();
  const corrected = snapshot({ amount: 1300, plannedDate: "2026-08-22", state: "marketplace_sent" });
  assert.ok(original && corrected);
  const first = upsertBrowserPayoutSnapshot({ version: 1, snapshots: [] }, original);
  const second = upsertBrowserPayoutSnapshot(first, corrected);
  assert.deepEqual(second.snapshots, [corrected]);
});

test("invalid money, dates and missing identity fail closed", () => {
  assert.equal(snapshot({ amount: 0 }), null);
  assert.equal(snapshot({ plannedDate: "21.08.2026" }), null);
  assert.equal(snapshot({ externalId: "" }), null);
  assert.equal(snapshot({ periodFrom: "2026-08-08", periodTo: "2026-08-01" }), null);
});

test("a browser payout links to exactly one report by id or exact period", () => {
  const reports = [{ reportId: "report-1", periodFrom: "2026-08-01", periodTo: "2026-08-07" }];
  const direct = snapshot();
  const byPeriod = snapshot({ reportId: null });
  assert.ok(direct && byPeriod);
  assert.equal(resolveBrowserPayoutReportId(direct, []), "report-1");
  assert.equal(resolveBrowserPayoutReportId(byPeriod, reports), "report-1");
  assert.equal(resolveBrowserPayoutReportId(byPeriod, [...reports, { ...reports[0], reportId: "report-2" }]), null);
});

test("гейт-прокси пропускает POST сборщика к само-гарду роута", async () => {
  const { readFile } = await import("node:fs/promises");
  const proxy = await readFile(new URL("../../proxy.ts", import.meta.url), "utf8");
  // Роут принимает FINANCE_MONITOR_SECRET, а прокси знает только CRON_SECRET:
  // без явного allowlist снимки умирали бы в гейте 401-м (грабли sheld-сборщика).
  assert.match(proxy, /\{ prefix: "\/api\/opiu\/browser-payout-snapshots", methods: \["POST"\] \}/);
  // Чтение снимков идёт под сессией — GET в публичный список попасть не должен.
  const collector = await readFile(new URL("./browser-collector/collector.mjs", import.meta.url), "utf8");
  assert.match(collector, /Bearer \$\{secret\}/);
});

test("снимок Ozon ложится на строку графика по составному ключу, а не по голому reportId", () => {
  // Регрессия: id строки графика Ozon — payoutReportKey, а resolveBrowserPayoutReportId
  // отдаёт reportId. Map по reportId промахивалась всегда, и в календарь уходила
  // РАСЧЁТНАЯ дата вместо фактической, хотя снимок кабинета был на руках.
  const snapshot = normalizeBrowserPayoutSnapshot({
    marketplace: "ozon",
    cabinetId: "cab-1",
    companyId: "co-1",
    accountId: "acc-1",
    externalId: "ozon:cab-1:report-77",
    reportId: "report-77",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-07",
    plannedDate: "2026-08-25",
    amount: 845231.55,
    state: "marketplace_sent",
    capturedAt: "2026-08-21T09:00:00.000Z",
  });
  assert.ok(snapshot);
  const reports = [{
    marketplace: "ozon" as const,
    cabinetId: "cab-1",
    companyId: "co-1",
    reportId: "report-77",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-07",
    amount: 845231.55,
    estimatedReceiptDate: "2026-08-27",
    state: "report_confirmed" as const,
  }];
  const scheduleRowId = payoutReportKey(reports[0]);
  const matched = browserPayoutsByScheduleId(snapshot ? [snapshot] : [], reports, payoutReportKey);
  assert.equal(matched.get(scheduleRowId)?.plannedDate, "2026-08-25");
  assert.equal(matched.get("report-77"), undefined);
});

test("у WB ключ строки графика — сам reportId", () => {
  const snapshot = normalizeBrowserPayoutSnapshot({
    marketplace: "wb",
    cabinetId: "cab-2",
    companyId: "co-2",
    accountId: "acc-2",
    externalId: "wb:cab-2:12345",
    reportId: "12345",
    periodFrom: "2026-08-01",
    periodTo: "2026-08-07",
    plannedDate: "2026-08-14",
    amount: 100,
    state: "awaiting_transfer",
    capturedAt: "2026-08-21T09:00:00.000Z",
  });
  assert.ok(snapshot);
  const reports = [{ reportId: "12345", periodFrom: "2026-08-01", periodTo: "2026-08-07" }];
  const matched = browserPayoutsByScheduleId(snapshot ? [snapshot] : [], reports, (report) => report.reportId);
  assert.equal(matched.get("12345")?.amount, 100);
});
