import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hourlyDashboardIdentity } from "../lib/cache/hourlyDashboard";
import {
  closedMoscowDates,
  isoDateRange,
  resolveSklejkiPeriod,
  shiftIsoDate,
  SKLEJKI_MAX_PERIOD_DAYS,
  sklejkiPeriod,
  sklejkiSpendWindowStart,
  type SklejkiPeriodResult,
} from "../lib/wb/sklejki";

const NOW = Date.parse("2026-07-14T00:30:00.000Z");

function periodOf(result: SklejkiPeriodResult) {
  if ("error" in result) assert.fail(`Ожидали период, получили ошибку: ${result.error}`);
  return result.period;
}

function errorOf(result: SklejkiPeriodResult) {
  if (!("error" in result)) assert.fail(`Ожидали ошибку, получили период ${result.period.label}`);
  return result.error;
}

test("склейки без параметров считают тот же период, что и раньше", () => {
  const period = periodOf(resolveSklejkiPeriod(null, null, NOW));
  const closedWeek = closedMoscowDates(7, NOW);
  const closedFortnight = closedMoscowDates(14, NOW);

  assert.deepEqual(
    { start: period.start, end: period.end, days: period.days, custom: period.custom },
    { start: closedWeek[0], end: closedWeek[6], days: 7, custom: false },
  );
  // Расход рекламы (adv_spend_14d) остаётся ровно прежним окном в 14 закрытых дней.
  assert.equal(period.spendWindowDays, 14);
  assert.equal(sklejkiSpendWindowStart(period), closedFortnight[0]);
  assert.equal(period.label, sklejkiPeriod(NOW));
});

test("склейки принимают произвольный период и удваивают окно расхода до потолка", () => {
  const week = periodOf(resolveSklejkiPeriod("2026-07-01", "2026-07-07", NOW));
  assert.deepEqual(
    { days: week.days, spend: week.spendWindowDays, start: sklejkiSpendWindowStart(week), custom: week.custom },
    { days: 7, spend: 14, start: "2026-06-24", custom: true },
  );

  const fortnight = periodOf(resolveSklejkiPeriod("2026-07-01", "2026-07-14", NOW));
  assert.deepEqual([fortnight.days, fortnight.spendWindowDays, sklejkiSpendWindowStart(fortnight)], [14, 28, "2026-06-17"]);

  // Длинный период не тянет вдвое больше строк рекламы, чем показывает экран.
  const month = periodOf(resolveSklejkiPeriod("2026-06-14", "2026-07-13", NOW));
  assert.deepEqual([month.days, month.spendWindowDays, sklejkiSpendWindowStart(month)], [30, 30, "2026-06-14"]);

  const quarter = periodOf(resolveSklejkiPeriod("2026-04-15", "2026-07-13", NOW));
  assert.deepEqual([quarter.days, quarter.spendWindowDays], [90, 90]);
});

test("склейки отбивают окно длиннее 90 дней и кривые границы", () => {
  const tooLong = errorOf(resolveSklejkiPeriod("2026-04-14", "2026-07-13", NOW));
  assert.match(tooLong, new RegExp(`${SKLEJKI_MAX_PERIOD_DAYS} дней`));
  assert.match(tooLong, /91/);

  assert.match(errorOf(resolveSklejkiPeriod("2026-07-13", "2026-07-01", NOW)), /позже конца/);
  assert.match(errorOf(resolveSklejkiPeriod("2026-07-01", null, NOW)), /парой параметров/);
  assert.match(errorOf(resolveSklejkiPeriod(null, "2026-07-01", NOW)), /парой параметров/);
  assert.match(errorOf(resolveSklejkiPeriod("01.07.2026", "2026-07-07", NOW)), /ГГГГ-ММ-ДД/);
  assert.match(errorOf(resolveSklejkiPeriod("2026-02-31", "2026-03-05", NOW)), /ГГГГ-ММ-ДД/);
});

test("период склеек попадает в ключ часового снимка, а дефолт сохраняет прогретый", () => {
  const identityFor = (result: SklejkiPeriodResult) => {
    const period = periodOf(result);
    return hourlyDashboardIdentity({
      cabinetId: "cab-a",
      from: period.custom ? period.start : undefined,
      to: period.custom ? period.end : undefined,
      schema: 5,
    });
  };
  const fallback = identityFor(resolveSklejkiPeriod(null, null, NOW));
  const july = identityFor(resolveSklejkiPeriod("2026-07-01", "2026-07-07", NOW));
  const june = identityFor(resolveSklejkiPeriod("2026-06-01", "2026-06-07", NOW));

  // Крон греет /api/sklejki без дат — дефолт обязан остаться прежним ключом.
  assert.equal(fallback, hourlyDashboardIdentity({ cabinetId: "cab-a", schema: 5 }));
  assert.notEqual(july, fallback);
  assert.notEqual(july, june);
});

test("дни периода перечисляются в UTC через границы месяца и года", () => {
  assert.deepEqual(isoDateRange("2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  assert.deepEqual(isoDateRange("2025-12-30", "2026-01-02"), ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  assert.equal(isoDateRange("2026-07-01", "2026-09-28").length, 90);
  assert.deepEqual(isoDateRange("2026-07-07", "2026-07-01"), []);
  assert.equal(shiftIsoDate("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftIsoDate("2026-02-28", 1), "2026-03-01");
});

test("роут склеек валидирует период, кладёт его в ключ снимка и в ответ", async () => {
  const route = await readFile(new URL("../app/api/sklejki/route.ts", import.meta.url), "utf8");

  assert.match(route, /resolveSklejkiPeriod\(params\.get\("date_from"\), params\.get\("date_to"\)\)/);
  assert.match(route, /error: resolved\.error \}, \{ status: 400 \}/);
  assert.match(route, /\{ cabinetId, from: period\.custom \? period\.start : undefined, to: period\.custom \? period\.end : undefined, schema: 5 \}/);
  // Верхняя граница у обоих запросов: открытый день не подмешивается в расход.
  assert.equal(route.match(/\.lte\("date", period\.end\)/g)?.length, 2);
  assert.equal(route.match(/period: periodPayload/g)?.length, 2);
});

test("экран склеек показывает выбор периода и шлёт его в запрос", async () => {
  const page = await readFile(new URL("../components/wb/WbSklejkiPage.tsx", import.meta.url), "utf8");

  assert.match(page, /<PeriodRangePicker/);
  assert.match(page, /date_from=\$\{encodeURIComponent\(dateFrom\)\}&date_to=\$\{encodeURIComponent\(dateTo\)\}/);
  for (const label of ["Неделя", "2 недели", "Месяц"]) assert.match(page, new RegExp(`label: "${label}"`));
  // Подпись периода берётся из ответа — экран не подписывает даты, которых не считал.
  assert.match(page, /data\?\.period\?\.label/);
});
