import assert from "node:assert/strict";
import test from "node:test";
import { browserPayoutKey, normalizeBrowserPayoutSnapshot, resolveBrowserPayoutReportId, upsertBrowserPayoutSnapshot } from "./browserPayoutSnapshots";

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
