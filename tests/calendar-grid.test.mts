import assert from "node:assert/strict";
import test from "node:test";

import {
  addMonths,
  anchorMonthFor,
  applyDayClick,
  buildCalendarMonth,
  calendarPair,
  formatRangeLabel,
  isWithinRange,
} from "../lib/ui/calendarGrid";

// Выбор периода двумя календарями (как в референсе). Сетка обязана начинаться
// с понедельника, показывать соседние дни серыми и не «висеть» пустой неделей;
// клик по дню задаёт границы независимо от порядка.

test("сетка месяца: недели с понедельника, свои и соседние дни", () => {
  // Август 2026: 1-е — суббота, значит первая неделя начинается 27 июля.
  const august = buildCalendarMonth(2026, 8);
  assert.equal(august.title, "Август 2026");
  assert.equal(august.weeks[0][0].iso, "2026-07-27");
  assert.equal(august.weeks[0][0].currentMonth, false);
  assert.equal(august.weeks[0][5].iso, "2026-08-01");
  assert.equal(august.weeks[0][5].currentMonth, true);
  // Каждая неделя — ровно 7 дней, и в каждой есть хотя бы один свой день.
  for (const week of august.weeks) {
    assert.equal(week.length, 7);
    assert.ok(week.some((cell) => cell.currentMonth));
  }
  // 31 августа — последний свой день сетки.
  const own = august.weeks.flat().filter((cell) => cell.currentMonth);
  assert.equal(own.length, 31);
  assert.equal(own.at(-1)?.iso, "2026-08-31");
});

test("февраль невисокосного и високосного года", () => {
  assert.equal(buildCalendarMonth(2026, 2).weeks.flat().filter((c) => c.currentMonth).length, 28);
  assert.equal(buildCalendarMonth(2028, 2).weeks.flat().filter((c) => c.currentMonth).length, 29);
});

test("переход через год в обе стороны", () => {
  assert.deepEqual(addMonths(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(addMonths(2026, 1, -1), { year: 2025, month: 12 });
  const [left, right] = calendarPair(2026, 12);
  assert.equal(left.title, "Декабрь 2026");
  assert.equal(right.title, "Январь 2027");
});

test("клик по дням задаёт диапазон в любом порядке", () => {
  const first = applyDayClick({ from: "2026-08-11", to: "2026-08-18" }, "2026-08-05");
  assert.deepEqual(first, { from: "2026-08-05", to: null });
  // Второй клик позже начала — обычный диапазон.
  assert.deepEqual(applyDayClick(first, "2026-08-09"), { from: "2026-08-05", to: "2026-08-09" });
  // Второй клик раньше начала — границы меняются местами, а не ломаются.
  assert.deepEqual(applyDayClick(first, "2026-08-01"), { from: "2026-08-01", to: "2026-08-05" });
});

test("подсветка диапазона и подпись", () => {
  assert.equal(isWithinRange("2026-08-12", "2026-08-11", "2026-08-18"), true);
  assert.equal(isWithinRange("2026-08-19", "2026-08-11", "2026-08-18"), false);
  // Выбрано только начало — подсвечен ровно один день.
  assert.equal(isWithinRange("2026-08-11", "2026-08-11", null), true);
  assert.equal(isWithinRange("2026-08-12", "2026-08-11", null), false);
  assert.equal(formatRangeLabel("2026-08-12", "2026-08-18"), "12.08.26 – 18.08.26");
});

test("якорный месяц — месяц начала периода, мусор не роняет", () => {
  assert.deepEqual(anchorMonthFor("2026-07-30", "2026-08-18"), { year: 2026, month: 7 });
  assert.deepEqual(anchorMonthFor("не дата", "2026-08-18"), { year: 2026, month: 8 });
});
