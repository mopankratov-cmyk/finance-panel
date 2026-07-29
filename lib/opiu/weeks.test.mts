import assert from "node:assert/strict";
import test from "node:test";

import { weeksInMonth } from "./weeks";

function localISODate(year: number, monthIndex: number, day: number): string {
  return [
    year,
    String(monthIndex + 1).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function expectedMonthDays(year: number, monthIndex: number): string[] {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) =>
    localISODate(year, monthIndex, index + 1),
  );
}

function datesInRange(from: string, to: string): string[] {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const cursor = new Date(fromYear, fromMonth - 1, fromDay);
  const end = new Date(toYear, toMonth - 1, toDay);
  const dates: string[] = [];

  while (cursor <= end) {
    dates.push(localISODate(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function assertAccountingRangesCoverMonthExactlyOnce(year: number, monthIndex: number): void {
  const weeks = weeksInMonth(year, monthIndex);
  const accountingDays = weeks.flatMap(({ rangeFrom, rangeTo }) =>
    datesInRange(rangeFrom, rangeTo),
  );

  assert.deepEqual(accountingDays, expectedMonthDays(year, monthIndex));
  assert.equal(new Set(accountingDays).size, accountingDays.length);
}

test("weeksInMonth keeps full-week labels but clips July 2026 accounting ranges", () => {
  const weeks = weeksInMonth(2026, 6);

  assert.deepEqual(weeks.at(0), {
    weekStart: "2026-06-29",
    rangeFrom: "2026-07-01",
    rangeTo: "2026-07-05",
    label: "29 июн. – 5 июл.",
  });
  assert.deepEqual(weeks.at(-1), {
    weekStart: "2026-07-27",
    rangeFrom: "2026-07-27",
    rangeTo: "2026-07-31",
    label: "27 июл. – 2 авг.",
  });
});

test("accounting ranges continuously cover only the requested month", () => {
  assertAccountingRangesCoverMonthExactlyOnce(2026, 6);
});

test("accounting ranges handle a year transition and leap February", () => {
  const january = weeksInMonth(2027, 0);
  assert.equal(january.at(0)?.weekStart, "2026-12-28");
  assert.equal(january.at(0)?.rangeFrom, "2027-01-01");
  assert.equal(january.at(-1)?.rangeTo, "2027-01-31");
  assertAccountingRangesCoverMonthExactlyOnce(2027, 0);

  const leapFebruary = weeksInMonth(2024, 1);
  assert.equal(leapFebruary.at(0)?.weekStart, "2024-01-29");
  assert.equal(leapFebruary.at(0)?.rangeFrom, "2024-02-01");
  assert.equal(leapFebruary.at(-1)?.rangeTo, "2024-02-29");
  assertAccountingRangesCoverMonthExactlyOnce(2024, 1);
});

test("weeksInMonth supports months spanning 4, 5, or 6 calendar weeks", () => {
  const cases = [
    { year: 2021, monthIndex: 1, expectedWeeks: 4 },
    { year: 2026, monthIndex: 3, expectedWeeks: 5 },
    { year: 2026, monthIndex: 7, expectedWeeks: 6 },
  ];

  for (const { year, monthIndex, expectedWeeks } of cases) {
    assert.equal(weeksInMonth(year, monthIndex).length, expectedWeeks);
    assertAccountingRangesCoverMonthExactlyOnce(year, monthIndex);
  }
});
