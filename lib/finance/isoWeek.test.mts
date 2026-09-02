import assert from "node:assert/strict";
import test from "node:test";
import { getISOWeekNumber, getRecentTransactions, getWeekBounds } from "../calculations.ts";
import type { Payment } from "../types.ts";

test("номер недели — по ISO 8601, включая границу года", () => {
  assert.equal(getISOWeekNumber(new Date(2026, 0, 1)), 1, "четверг 1 января 2026 — W01");
  assert.equal(getISOWeekNumber(new Date(2026, 11, 31)), 53, "2026 — год из 53 недель");
  assert.equal(getISOWeekNumber(new Date(2027, 0, 1)), 53, "пятница 1 января 2027 — ещё W53 2026-го");
  assert.equal(getISOWeekNumber(new Date(2027, 0, 4)), 1, "понедельник 4 января 2027 — W01");
  assert.equal(getISOWeekNumber(new Date(2027, 5, 15)), 24);
  assert.equal(getWeekBounds("2027-06-15").weekNumber, 24);
});

test("в «последних операциях» нет отменённых", () => {
  const base = { name: "", amount: -1, category: "Прочее", accountId: "a", counterparty: "" };
  const payments: Payment[] = [
    { id: "1", date: "2026-09-03", status: "cancelled", ...base },
    { id: "2", date: "2026-09-02", status: "done", ...base },
    { id: "3", date: "2026-09-01", status: "planned", ...base },
  ];
  assert.deepEqual(getRecentTransactions(payments, 10).map((payment) => payment.id), ["2", "3"]);
});
