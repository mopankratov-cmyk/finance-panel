import { strict as assert } from "node:assert";
import test from "node:test";
import { ozonRangeFor, ozonToday, resolveOzonPeriod } from "../lib/ozon/period";

/**
 * Регрессия: сервер считал «сегодня» по UTC, браузер — по часам пользователя.
 * С полуночи до трёх часов ночи по Москве это разные даты: сервер отрезал у
 * периода сегодняшний день, пресет «Сегодня» показывал вчерашние данные, а
 * прогретые снимки переставали совпадать с тем, что просит интерфейс.
 */

// 30 августа 2026, 00:30 по Москве — это ещё 29 августа по UTC.
const MOSCOW_NIGHT = new Date("2026-08-29T21:30:00.000Z");

test("«сегодня» считается по Москве, а не по UTC", () => {
  assert.equal(ozonToday(MOSCOW_NIGHT), "2026-08-30");
  assert.notEqual(ozonToday(MOSCOW_NIGHT), MOSCOW_NIGHT.toISOString().slice(0, 10));
});

test("ночью период не теряет сегодняшний день", () => {
  const range = ozonRangeFor("two_weeks", MOSCOW_NIGHT);
  assert.deepEqual(range, { from: "2026-08-17", to: "2026-08-30" });

  const period = resolveOzonPeriod(range.from, range.to, 14, MOSCOW_NIGHT);
  assert.deepEqual([period.from, period.to, period.days], ["2026-08-17", "2026-08-30", 14]);
  assert.equal(period.endsToday, true, "иначе снимок «последних N дней» не подойдёт периоду");
});

test("пресет «Сегодня» ночью — это наступивший день", () => {
  assert.deepEqual(ozonRangeFor("today", MOSCOW_NIGHT), { from: "2026-08-30", to: "2026-08-30" });
  assert.deepEqual(ozonRangeFor("yesterday", MOSCOW_NIGHT), { from: "2026-08-29", to: "2026-08-29" });
});

test("месяц и предыдущий месяц берутся от московской даты", () => {
  assert.deepEqual(ozonRangeFor("month", MOSCOW_NIGHT), { from: "2026-08-01", to: "2026-08-30" });
  assert.deepEqual(ozonRangeFor("previous", MOSCOW_NIGHT), { from: "2026-07-01", to: "2026-07-31" });
});

test("границы одинаковы независимо от часового пояса процесса", () => {
  // Тот же момент времени, разные представления — результат обязан совпасть.
  const asNumber = ozonRangeFor("week", new Date(MOSCOW_NIGHT.getTime()));
  const asDate = ozonRangeFor("week", MOSCOW_NIGHT);
  assert.deepEqual(asNumber, asDate);
  assert.equal(asDate.to, "2026-08-30");
});
