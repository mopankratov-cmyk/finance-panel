import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import { collectorAgeLabel, collectorFreshness, latestIso, PAYOUT_STALL_HOURS, SHELF_STALL_HOURS } from "../lib/collectorFreshness";

/**
 * Сборщики на Mac mini (полки, снимки выплат) об отказах пишут только в свой
 * лог. 21.09–01.10.2026 полки стояли десять дней, и в панели этого не было
 * видно. Теперь застой — явная плашка.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const NOW = Date.parse("2026-10-01T09:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

test("самый свежий снимок — по времени, пустые и нечитаемые пропускаются", () => {
  assert.equal(latestIso([hoursAgo(30), null, "мусор", hoursAgo(2), undefined, hoursAgo(10)]), hoursAgo(2));
  assert.equal(latestIso([null, undefined, ""]), null);
  // Разные записи одного момента (с зоной и без миллисекунд) — одно и то же время.
  assert.equal(latestIso(["2026-09-21T23:20:20+03:00", "2026-09-21T20:20:20.000Z"]), "2026-09-21T20:20:20.000Z");
});

test("встал — только если снимки были и самый свежий старше порога", () => {
  assert.deepEqual(collectorFreshness(null, 24, NOW), { lastAt: null, hours: null, label: "снимков нет", stalled: false }, "кабинет без сборщика — не тревога");
  assert.equal(collectorFreshness(hoursAgo(12), SHELF_STALL_HOURS, NOW).stalled, false, "штатная ночная пауза полок");
  assert.equal(collectorFreshness(hoursAgo(25), SHELF_STALL_HOURS, NOW).stalled, true);
  assert.equal(collectorFreshness(hoursAgo(7), PAYOUT_STALL_HOURS, NOW).stalled, false, "один пропущенный прогон выплат");
  assert.equal(collectorFreshness(hoursAgo(240), PAYOUT_STALL_HOURS, NOW).label, "10 дн назад");
  assert.equal(collectorFreshness("не дата", 24, NOW).stalled, false);
});

test("подпись возраста", () => {
  assert.equal(collectorAgeLabel(0.4), "меньше часа назад");
  assert.equal(collectorAgeLabel(5.4), "5 ч назад");
  assert.equal(collectorAgeLabel(49), "2 дн назад");
});

test("«Полки»: плашка застоя — по активным артикулам, над списком", () => {
  const page = read("../components/wb/WbShelfPage.tsx");
  assert.match(page, /collectorFreshness\(latestIso\(items\.filter\(\(item\) => item\.watch\.active\)\.map\(\(item\) => item\.latest\?\.collectedAt\)\), SHELF_STALL_HOURS\)/);
  assert.match(page, /shelfFreshness\.stalled && shelfFreshness\.lastAt \? \(\s*<div role="alert"/);
  assert.match(page, /Сбор полок встал/);
});

test("выплаты: свежесть агента — отдельным запросом, без снимков и без правки предложений календаря", () => {
  const route = read("../app/api/opiu/browser-payout-snapshots/route.ts");
  // Ветка свежести — до проверки года и месяца: ей они не нужны.
  assert.ok(route.indexOf('searchParams.get("freshness") === "1"') < route.indexOf('const year = Number(request.nextUrl.searchParams.get("year"))'));
  const freshnessFn = route.slice(route.indexOf("async function freshness("), route.indexOf("export async function POST("));
  assert.match(freshnessFn, /sessionHasCabinetAccess\(session, cabinetId\)/, "доступ к кабинету — как у остальных веток");
  assert.match(freshnessFn, /return NextResponse\.json\(\{ lastCapturedAt: latestIso\(captured\) \}\)/);
  assert.doesNotMatch(freshnessFn, /snapshots:/, "сами снимки не отдаются");
  const panel = read("../components/calendar/BrowserPayoutSnapshotsPanel.tsx");
  const effect = panel.slice(panel.indexOf('const query = new URLSearchParams({ freshness: "1"'), panel.indexOf("return () => controller.abort();"));
  assert.ok(effect.length > 0);
  assert.doesNotMatch(effect, /onChange\(/, "запрос свежести не трогает предложения календаря");
  assert.match(panel, /collectorFreshness\(lastCapturedAt, PAYOUT_STALL_HOURS\)/);
  assert.match(panel, /Агент не присылал снимки больше суток/);
});
