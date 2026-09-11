import assert from "node:assert/strict";
import test from "node:test";

import { currentWeekStartParam, mondayOfWeek, todayParam, weeksEndingAt } from "./weeks";

function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

test("weeksEndingAt returns full, unclipped weeks ending in the week containing endDate", () => {
  const weeks = weeksEndingAt("2026-07-01", 4); // 2026-07-01 — среда, неделя 29 июн. – 5 июл.

  assert.equal(weeks.length, 4);
  assert.deepEqual(weeks.at(0), {
    weekStart: "2026-06-08",
    rangeFrom: "2026-06-08",
    rangeTo: "2026-06-14",
    label: "8 июн. – 14 июн.",
  });
  assert.deepEqual(weeks.at(-1), {
    weekStart: "2026-06-29",
    rangeFrom: "2026-06-29",
    rangeTo: "2026-07-05",
    label: "29 июн. – 5 июл.",
  });
});

test("weeksEndingAt weeks are contiguous full 7-day ranges (no gaps, no clipping at month boundary)", () => {
  const weeks = weeksEndingAt("2026-07-01", 4);
  for (let i = 1; i < weeks.length; i++) {
    assert.equal(weeks[i]!.rangeFrom, addDaysISO(weeks[i - 1]!.rangeTo, 1));
  }
  for (const w of weeks) {
    assert.equal(w.rangeFrom, w.weekStart);
    assert.equal(w.rangeTo, addDaysISO(w.weekStart, 6));
  }
});

test("weeksEndingAt treats Monday and Sunday endDate as the same week", () => {
  const fromMonday = weeksEndingAt("2026-06-29", 1);
  const fromSunday = weeksEndingAt("2026-07-05", 1);
  assert.equal(fromMonday.length, 1);
  assert.equal(fromSunday.length, 1);
  assert.equal(fromMonday[0]!.weekStart, "2026-06-29");
  assert.equal(fromSunday[0]!.weekStart, "2026-06-29");
});

test("mondayOfWeek resolves every weekday of a week to the same Monday", () => {
  const expected = "2026-06-29";
  for (let offset = 0; offset <= 6; offset++) {
    assert.equal(mondayOfWeek(addDaysISO(expected, offset)), expected);
  }
});

test("currentWeekStartParam matches mondayOfWeek(todayParam()) and is a Monday", () => {
  const weekStart = currentWeekStartParam();
  assert.equal(weekStart, mondayOfWeek(todayParam()));
  assert.equal(new Date(`${weekStart}T00:00:00`).getDay(), 1);
});
