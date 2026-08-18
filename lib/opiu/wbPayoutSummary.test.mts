import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

const {
  allocateWbPayoutSchedule,
  deriveWbConfirmedPayoutSchedule,
  deriveWbForecastReceiptDates,
  deriveWbLegacySnapshotPayout,
  deriveWbPayoutSummary,
} = await import("./forecast");

test("WB payout keeps report accrual separate from unavailable bank fact", () => {
  const summary = deriveWbPayoutSummary(1_000, 400);

  assert.deepEqual(summary, {
    reportAccruedPayout: 400,
    actualPayout: null,
    remainingPayout: 600,
  });
  assert.deepEqual(deriveWbLegacySnapshotPayout(summary), {
    actual_payout: 0,
    remaining_payout: 600,
  });
});

test("WB payout never exposes an invalid or negative forecast remainder", () => {
  assert.equal(deriveWbPayoutSummary(-1, 400).remainingPayout, 0);
  assert.equal(deriveWbPayoutSummary(Number.NaN, 400).remainingPayout, 0);
});

test("WB reports keep separate stable identities and replace forecast remainder", () => {
  const rows = [
    { realizationreport_id: 101, rr_dt: "2026-08-10", ppvz_for_pay: 100 },
    { realizationreport_id: 101, rr_dt: "2026-08-11", ppvz_for_pay: 50, delivery_rub: 10 },
    { realizationreport_id: 102, rr_dt: "2026-08-11", ppvz_for_pay: 25 },
  ];
  const schedule = deriveWbConfirmedPayoutSchedule(rows);
  assert.deepEqual(schedule.map((row) => [row.id, row.amount]), [["101", 140], ["102", 25]]);
  assert.equal(schedule[0].date, "2026-08-20");
  assert.equal(deriveWbPayoutSummary(500, 165).remainingPayout, 335);
});

test("WB forecast dates include conservative withdrawal and bank delay", () => {
  assert.deepEqual(deriveWbForecastReceiptDates(2026, 8, [7, 14]), ["2026-09-01", "2026-09-08"]);
});

test("WB payout schedule distributes whole cents across dates in input order", () => {
  const dates = ["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28"];

  assert.deepEqual(allocateWbPayoutSchedule(2, dates), [
    { date: "2026-08-07", amount: 0.5 },
    { date: "2026-08-14", amount: 0.5 },
    { date: "2026-08-21", amount: 0.5 },
    { date: "2026-08-28", amount: 0.5 },
  ]);
  assert.deepEqual(allocateWbPayoutSchedule(0.02, dates), [
    { date: "2026-08-07", amount: 0.01 },
    { date: "2026-08-14", amount: 0.01 },
  ]);
});

test("WB payout schedule is positive and cent-exact for uneven distributions", () => {
  const schedule = allocateWbPayoutSchedule(
    100.01,
    ["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28"],
  );

  assert.equal(schedule.length, 4);
  assert.ok(schedule.every(({ amount }) => amount >= 0.01));
  assert.equal(
    schedule.reduce((total, { amount }) => total + Math.round(amount * 100), 0),
    10_001,
  );
});

test("WB payout schedule ignores invalid, non-positive, or undated amounts", () => {
  const dates = ["2026-08-07"];

  assert.deepEqual(allocateWbPayoutSchedule(0, dates), []);
  assert.deepEqual(allocateWbPayoutSchedule(Number.NaN, dates), []);
  assert.deepEqual(allocateWbPayoutSchedule(-1, dates), []);
  assert.deepEqual(allocateWbPayoutSchedule(1, []), []);
});

test("WB payout schedule rejects amounts that overflow safe integer cents", () => {
  assert.throws(
    () => allocateWbPayoutSchedule(Number.MAX_VALUE, ["2026-08-07"]),
    RangeError,
  );
});

test("WB payout schedule rounds decimal money half-up to cents", () => {
  const schedule = allocateWbPayoutSchedule(
    1.005,
    ["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28"],
  );
  const cents = schedule.map(({ amount }) => Math.round(amount * 100));

  assert.equal(cents.reduce((total, amount) => total + amount, 0), 101);
  assert.ok(schedule.every(({ amount }) => Number.isFinite(amount) && amount > 0));
});
