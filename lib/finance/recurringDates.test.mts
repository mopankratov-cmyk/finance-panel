import assert from "node:assert/strict";
import test from "node:test";
import { expandRecurringPayment, nthRecurrenceDate } from "../../components/calendar/recurringPayments.ts";

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

test("ежемесячный платёж 31-го числа держится за конец месяца и не пропускает февраль", () => {
  const start = new Date(2026, 0, 31);
  assert.deepEqual([0, 1, 2, 3, 4].map((index) => iso(nthRecurrenceDate(start, "monthly", index))), [
    "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31",
  ]);
});

test("квартальный и годовой повторы не уползают", () => {
  assert.equal(iso(nthRecurrenceDate(new Date(2026, 10, 30), "quarterly", 1)), "2027-02-28");
  assert.equal(iso(nthRecurrenceDate(new Date(2024, 1, 29), "yearly", 1)), "2025-02-28");
  assert.equal(iso(nthRecurrenceDate(new Date(2026, 0, 5), "weekly", 2)), "2026-01-19");
});

test("серия раскрывается до даты «до» включительно", () => {
  const series = expandRecurringPayment(
    { date: "2026-01-31", name: "Аренда", amount: -100, category: "Прочее", accountId: "a", status: "planned", counterparty: "" },
    { frequency: "monthly", until: "2026-04-30" },
  );
  assert.deepEqual(series.map((payment) => payment.date), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.ok(series.every((payment) => payment.comment?.includes("[series:")));
});
