import assert from "node:assert/strict";
import test from "node:test";
import { accrualDates, buildLoanSchedule, principalAtMaturity, type LoanTerms } from "./scheduleModel.ts";

const base: LoanTerms = { principal: 1_000_000, startDate: "2026-02-01", dueDate: "2027-02-01", annualRate: 24, interestFrequency: "monthly", rateMode: "flat_period", dayCountBasis: 365, interestPayout: "paid" };

test("простой договор: 12 процентных строк по 2% и тело в дату возврата", () => {
  const rows = buildLoanSchedule(base);
  const interest = rows.filter((row) => row.kind === "interest");
  assert.equal(interest.length, 12);
  assert.ok(interest.every((row) => row.amount === 20_000));
  assert.deepEqual(rows.at(-1), { dueDate: "2027-02-01", kind: "principal", amount: 1_000_000, balanceBefore: 1_000_000, balanceAfter: 0 });
  assert.equal(accrualDates(base).length, 12);
});

test("договор Дзюбина: 3% в месяц, выплаченные проценты каждый квартал реинвестируются → 5 млн × 1,09¹²", () => {
  const rows = buildLoanSchedule({ ...base, principal: 5_000_000, startDate: "2023-07-15", dueDate: "2026-07-15", annualRate: 36, monthlyRate: 3, reinvestEveryPeriods: 3 });
  assert.equal(rows.filter((row) => row.kind === "interest").length, 36);
  assert.equal(rows[0].amount, 150_000, "первый месяц — 3% от 5 млн");
  assert.equal(rows[3].amount, 163_500, "после первого квартала долг 5 450 000");
  assert.equal(principalAtMaturity({ ...base, principal: 5_000_000, startDate: "2023-07-15", dueDate: "2026-07-15", annualRate: 36, monthlyRate: 3, reinvestEveryPeriods: 3 }), 14_063_323.91);
});

test("капитализация: проценты не платятся, а растят долг", () => {
  const terms: LoanTerms = { ...base, interestPayout: "capitalized", dueDate: "2026-05-01" };
  const rows = buildLoanSchedule(terms);
  assert.equal(rows.filter((row) => row.kind === "interest").length, 0);
  assert.equal(rows.at(-1)?.amount, 1_061_208, "1 млн × 1,02³");
});

test("допвзнос и транши увеличивают остаток с указанной даты", () => {
  const withContribution = buildLoanSchedule({ ...base, extraContributions: [{ date: "2026-06-15", amount: 500_000 }] });
  const july = withContribution.find((row) => row.dueDate === "2026-08-01");
  assert.equal(july?.amount, 30_000, "2% от 1,5 млн после взноса");
  assert.equal(withContribution.at(-1)?.amount, 1_500_000);
  const tranches = buildLoanSchedule({ ...base, tranches: [{ date: "2026-02-01", amount: 400_000 }, { date: "2026-03-10", amount: 600_000 }] });
  assert.equal(tranches[0].amount, 8_000, "первый месяц — только первый транш");
  assert.equal(tranches.at(-1)?.amount, 1_000_000);
});

test("по дням: остаток × ставка × дни / базис", () => {
  const rows = buildLoanSchedule({ ...base, rateMode: "actual_days", interestFrequency: "at_maturity", dueDate: "2026-03-03" });
  assert.equal(rows[0].kind, "interest");
  assert.equal(rows[0].amount, Math.round(1_000_000 * 0.24 * 30 / 365 * 100) / 100);
});
