import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../components/calendar/CalendarPage.tsx", import.meta.url), "utf8");

/**
 * Период календаря отдали не тому компоненту: DayDetailPanel о нём не знает
 * вовсе, а ReplaceCalendarModal требует его обязательным. Сборка легла на
 * типах, и вместе с ней встали все выкладки — прод три часа не мог обновиться.
 */

test("период календаря уходит разбору сетки, а не панели дня", () => {
  const modal = page.slice(page.indexOf("<ReplaceCalendarModal"));
  assert.match(modal, /calendarPeriod=\{\{ year, month: month \+ 1 \}\}/);

  const panelStart = page.indexOf("<DayDetailPanel");
  const panel = page.slice(panelStart, page.indexOf("/>", panelStart));
  assert.equal(
    /calendarPeriod/.test(panel),
    false,
    "DayDetailPanel такого пропа не принимает — на нём падала сборка",
  );
});
