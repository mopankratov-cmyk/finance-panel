import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { hourlyDashboardIdentity } from "../lib/cache/hourlyDashboard";
import {
  clampFunnelPeriod,
  FUNNEL_MAX_PERIOD_DAYS,
  funnelPeriodDates,
  resolveFunnelPeriod,
} from "../lib/wb/funnelMetrics";
import { closedMoscowDates } from "../lib/wb/sklejki";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

// «Воронка» отдаёт период двумя календарями. Границы едут в оба её API, поэтому
// разбор дат обязан быть общим и строгим: подменить запрошенный диапазон соседним
// нельзя — экран подпишет колонки днями, которых сервер не считал.

test("пустые границы — это дефолт, а не ошибка", () => {
  for (const [from, to] of [[null, null], ["", ""], [undefined, undefined]] as const) {
    const resolved = resolveFunnelPeriod(from, to);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.ok && resolved.period, null);
  }
});

test("корректная пара дат принимается с длиной периода", () => {
  const resolved = resolveFunnelPeriod("2026-07-28", "2026-08-03");
  assert.ok(resolved.ok);
  assert.deepEqual(resolved.period, { start: "2026-07-28", end: "2026-08-03", days: 7 });
});

test("невалидный период отклоняется по-русски, а не подменяется дефолтом", () => {
  const cases: Array<[string | null, string | null, RegExp]> = [
    ["2026-08-01", null, /одна граница без второй/],
    [null, "2026-08-01", /одна граница без второй/],
    ["01.08.2026", "2026-08-05", /ГГГГ-ММ-ДД/],
    ["2026-8-1", "2026-08-05", /ГГГГ-ММ-ДД/],
    ["2026-02-31", "2026-03-05", /ГГГГ-ММ-ДД/],
    ["2026-08-10", "2026-08-01", /Начало периода позже/],
  ];
  for (const [from, to, message] of cases) {
    const resolved = resolveFunnelPeriod(from, to);
    assert.equal(resolved.ok, false, `${from}..${to} должен быть отклонён`);
    assert.match(resolved.ok ? "" : resolved.error, message);
  }
});

test("предел окна — 90 дней, отказ называет запрошенную длину", () => {
  const ninety = resolveFunnelPeriod("2026-05-09", "2026-08-06");
  assert.ok(ninety.ok);
  assert.equal(ninety.period?.days, FUNNEL_MAX_PERIOD_DAYS);

  const overflow = resolveFunnelPeriod("2026-05-08", "2026-08-06");
  assert.equal(overflow.ok, false);
  assert.match(overflow.ok ? "" : overflow.error, /не больше 90 дней, запрошено 91/);
});

test("дни периода перечисляются в UTC — через месяц и год без сдвига", () => {
  assert.deepEqual(funnelPeriodDates("2025-12-30", "2026-01-02"), ["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"]);
  assert.deepEqual(funnelPeriodDates("2026-02-27", "2026-03-01"), ["2026-02-27", "2026-02-28", "2026-03-01"]);
  assert.deepEqual(funnelPeriodDates("2026-08-05", "2026-08-05"), ["2026-08-05"]);
  assert.deepEqual(funnelPeriodDates("2026-08-05", "2026-08-01"), []);
  assert.deepEqual(funnelPeriodDates("вчера", "2026-08-01"), []);
});

test("пресет и перечисление дают одни и те же дни — колонки не разъедутся", () => {
  const nowMs = Date.parse("2026-08-18T09:00:00.000Z");
  for (const days of [1, 7, 30]) {
    const preset = closedMoscowDates(days, nowMs);
    assert.deepEqual(funnelPeriodDates(preset[0], preset[preset.length - 1]), preset);
  }
});

test("экран режет начало периода до предела API, конец остаётся выбранным", () => {
  const short = clampFunnelPeriod("2026-07-28", "2026-08-03");
  assert.deepEqual(short, { from: "2026-07-28", to: "2026-08-03", clamped: false });

  const long = clampFunnelPeriod("2026-01-01", "2026-08-06");
  assert.equal(long.clamped, true);
  assert.equal(long.to, "2026-08-06");
  assert.equal(funnelPeriodDates(long.from, long.to).length, FUNNEL_MAX_PERIOD_DAYS);
  assert.ok(resolveFunnelPeriod(long.from, long.to).ok);
});

test("оба API воронки разбирают ?date_from/?date_to общим помощником и отвечают 400", async () => {
  for (const path of ["../app/api/seo/skus/route.ts", "../app/api/design/day-metrics/route.ts"]) {
    const route = await source(path);
    assert.match(route, /resolveFunnelPeriod\(/, `${path} без общего разбора периода`);
    assert.match(route, /date_from/, `${path} не читает date_from`);
    assert.match(route, /date_to/, `${path} не читает date_to`);
    assert.match(route, /NextResponse\.json\(\{ error: requested\.error \}, \{ status: 400 \}\)/, `${path} без 400 на кривой период`);
  }
});

test("посуточный API держит верхнюю границу и не теряет прогретый снимок", async () => {
  const route = await source("../app/api/design/day-metrics/route.ts");
  // Верхняя граница появляется только вместе с запрошенным периодом — обе выборки.
  assert.equal((route.match(/if \(until\) query = query\.lte\("date", until\);/g) ?? []).length, 2);
  assert.match(route, /\{ cabinetId: p_cabinet, since, until, schema: 4 \}/);
  // Крон греет /api/design/day-metrics без дат: until=undefined обязан давать
  // ровно тот же ключ, что и до появления периода, иначе снимок собирается заново.
  const warmed = hourlyDashboardIdentity({ cabinetId: "cab-a", since: "2026-07-19", schema: 4 });
  const requested = hourlyDashboardIdentity({ cabinetId: "cab-a", since: "2026-07-19", until: undefined, schema: 4 });
  assert.equal(requested, warmed);
  assert.notEqual(hourlyDashboardIdentity({ cabinetId: "cab-a", since: "2026-07-19", until: "2026-08-01", schema: 4 }), warmed);
});

test("оборачиваемость считается по длине периода, а не по ?window=", async () => {
  const route = await source("../app/api/seo/skus/route.ts");
  assert.match(route, /const periodDays = funnelPeriodDates\(period\.start, period\.end\)\.length;/);
  assert.match(route, /Math\.round\(stock \/ \(w\.oc \/ periodDays\)\)/);
  assert.match(route, /window_days: periodDays/);
  assert.doesNotMatch(route, /w\.oc \/ days/);
});

test("выбор периода в «Воронке» — один пикер, и его границы доезжают до обоих запросов", async () => {
  const page = await source("../components/wb/WbFunnelPage.tsx");
  assert.match(page, /import \{ PeriodRangePicker \} from "@\/components\/ui\/PeriodRangePicker";/);
  assert.match(page, /<PeriodRangePicker/);
  // Пресеты живут внутри пикера — отдельного ряда кнопок «Вчера/7/30» больше нет.
  assert.doesNotMatch(page, /\[1, 7, 30\]\.map/);
  assert.match(page, /const PERIOD_PRESETS = \[/);
  assert.equal((page.match(/const periodPicker = \(/g) ?? []).length, 1);
  // Даты уезжают только при своём периоде — дефолт остаётся запросом крона.
  assert.match(page, /const range = period\.custom \? `&date_from=\$\{period\.from\}&date_to=\$\{period\.to\}` : "";/);
  assert.match(page, /\/api\/seo\/skus\?window=\$\{windowDays\}&cabinet=\$\{cabinet\}\$\{range\}/);
  assert.match(page, /\/api\/design\/day-metrics\?cabinet=\$\{cabinet\}\$\{range\}/);
  // Перезагрузка при смене периода и колонки строго по его дням.
  assert.match(page, /period\.custom, period\.from, period\.to/);
  assert.match(page, /const dates = useMemo\(\(\) => funnelPeriodDates\(period\.from, period\.to\)/);
  // Данные WB за сегодня неполные — дальше вчерашнего календарь не пускает.
  assert.match(page, /maxIso=\{lastClosedDay\}/);
});
