import { strict as assert } from "node:assert";
import test from "node:test";
import { ozonRangeFor, previousOzonPeriod, resolveOzonPeriod, OZON_MAX_PERIOD_DAYS } from "../lib/ozon/period.ts";

const NOW = new Date(2026, 7, 24); // 24 августа 2026, локальное время

test("без дат работает по-старому: последние N дней до сегодня", () => {
  const period = resolveOzonPeriod(null, null, 14, NOW);
  assert.deepEqual([period.from, period.to, period.days], ["2026-08-11", "2026-08-24", 14]);
  assert.equal(period.endsToday, true);
});

test("календарь задаёт произвольный отрезок, в том числе в прошлом", () => {
  const period = resolveOzonPeriod("2026-03-01", "2026-03-31", 14, NOW);
  assert.deepEqual([period.from, period.to, period.days], ["2026-03-01", "2026-03-31", 31]);
  // Кэш «последних N дней» такому периоду не годится — он кончился в прошлом.
  assert.equal(period.endsToday, false);
});

test("перевёрнутые границы разворачиваются, а не ломают запрос", () => {
  const period = resolveOzonPeriod("2026-08-20", "2026-08-10", 14, NOW);
  assert.deepEqual([period.from, period.to], ["2026-08-10", "2026-08-20"]);
});

test("будущее отсекается: за завтра данных нет", () => {
  const period = resolveOzonPeriod("2026-08-20", "2026-12-31", 14, NOW);
  assert.equal(period.to, "2026-08-24");
});

test("слишком длинный период укорачивается с начала — правая граница человеку важнее", () => {
  const period = resolveOzonPeriod("2025-01-01", "2026-08-24", 14, NOW);
  assert.equal(period.days, OZON_MAX_PERIOD_DAYS);
  assert.equal(period.to, "2026-08-24");
});

test("предыдущий период стоит вплотную и равен по длине", () => {
  const period = resolveOzonPeriod("2026-08-11", "2026-08-24", 14, NOW);
  assert.deepEqual(previousOzonPeriod(period), { from: "2026-07-28", to: "2026-08-10" });
});

test("пресеты совпадают с РНП WB по смыслу", () => {
  assert.deepEqual(ozonRangeFor("yesterday", NOW), { from: "2026-08-23", to: "2026-08-23" });
  assert.deepEqual(ozonRangeFor("week", NOW), { from: "2026-08-18", to: "2026-08-24" });
  assert.deepEqual(ozonRangeFor("two_weeks", NOW), { from: "2026-08-11", to: "2026-08-24" });
  assert.deepEqual(ozonRangeFor("month", NOW), { from: "2026-08-01", to: "2026-08-24" });
  assert.deepEqual(ozonRangeFor("previous", NOW), { from: "2026-07-01", to: "2026-07-31" });
});
