import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { moscowToday, shiftIsoDay } from "../lib/sync/moscowDay";

/**
 * Окно синка рекламы строилось по UTC. Вечером по Москве (после 21:00) UTC-дата
 * ещё вчерашняя, и сегодняшний день в окно не попадал — расход подтягивался
 * только на следующие сутки.
 */

test("вечер по Москве — уже завтрашний день относительно UTC", () => {
  // 30 августа 21:30 UTC = 31 августа 00:30 по Москве.
  assert.equal(moscowToday(new Date("2026-08-30T21:30:00.000Z")), "2026-08-31");
  assert.equal(new Date("2026-08-30T21:30:00.000Z").toISOString().slice(0, 10), "2026-08-30");
});

test("день по Москве не прыгает внутри суток", () => {
  assert.equal(moscowToday(new Date("2026-08-31T00:00:00.000Z")), "2026-08-31");
  assert.equal(moscowToday(new Date("2026-08-31T20:59:00.000Z")), "2026-08-31");
});

test("сдвиг даты не зависит от часового пояса", () => {
  assert.equal(shiftIsoDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftIsoDay("2026-12-31", 1), "2027-01-01");
});

test("синк рекламы строит окно по московскому календарю", () => {
  const sync = readFileSync(new URL("../app/api/sync/advert-stats/route.ts", import.meta.url), "utf8");
  assert.match(sync, /moscowToday\(\)/);
  assert.equal(
    /new Date\(Date\.now\(\) - DAYS_BACK \* 86400000\)/.test(sync),
    false,
    "окно по UTC теряло сегодняшний московский день",
  );
});
