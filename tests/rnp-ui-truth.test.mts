import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RNP_METRIC_FIELDS } from "../lib/rnp/operatingMatrix";

const page = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");

/**
 * Экран РНП молча съедал часть выбора и путался в датах: метрики вне групп
 * никогда не рисовались, подпись «данные на» уезжала на день, а журнал
 * сопоставлялся по «ДД.ММ» без года.
 */

test("каждая метрика каталога попадает хотя бы в одну группу таблицы", () => {
  const block = page.slice(page.indexOf("const OPTIMA_TABLE_GROUPS"), page.indexOf("const RNP_FILTER_PRESETS_STORAGE_KEY"));
  const declared = new Set([...block.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]));
  const missing = RNP_METRIC_FIELDS.filter((field) => !declared.has(field));
  assert.deepEqual(missing, [], `эти метрики выбираются, но не рисуются: ${missing.join(", ")}`);
});

test("метрика вне групп не исчезает, а падает в «Прочее»", () => {
  // Страховка на будущее: забытая группа больше не съест выбор человека.
  assert.match(page, /const ungrouped = metrics\.filter\(\(metric\) => !groupedFields\.has\(metric\.field\)\);/);
  assert.match(page, /label: "Прочее"/);
});

test("подпись «данные на» не гоняет дату через Date", () => {
  assert.match(page, /activeData\.as_of\.slice\(0, 10\)\.split\("-"\)\.reverse\(\)\.join\("\."\)/);
  assert.equal(/new Date\(activeData\.as_of\)/.test(page), false, "полночь UTC сдвигала день назад");
});

test("дата колонки журнала считается от начала периода, а не из года конца", () => {
  assert.match(page, /setOperationsInitialDate\(shiftIsoDay\(range\.from, index\)\)/);
  assert.match(page, /const iso = periodFrom \? shiftIsoDay\(periodFrom, index\) : null;/);
  assert.equal(
    /entry\.event_date\.slice\(8, 10\)\}\.\$\{entry\.event_date\.slice\(5, 7\)\}` === day\.label/.test(page),
    false,
    "сопоставление по ДД.ММ тянуло события прошлых лет",
  );
});

test("недельная маржа не считается по чужому знаменателю", () => {
  const matrix = readFileSync(new URL("../lib/rnp/operatingMatrix.ts", import.meta.url), "utf8");
  // Сервер делит прибыль на выкупы только тех SKU, у кого есть себестоимость;
  // такого знаменателя в наборе метрик нет, поэтому недельного пересчёта тут
  // быть не должно — иначе неделя разойдётся с колонкой «Итого».
  const pairs = matrix.slice(matrix.indexOf("WEEKLY_RATIO_PAIRS"), matrix.indexOf("WEEKLY_POINT_IN_TIME"));
  assert.equal(/^\s*margin_pct:/m.test(pairs), false);
  assert.match(pairs, /net_margin_pct: \{ numerator: "net_profit"/);
});

test("«Выкуплено» стоит в основном блоке рядом с «Выкупы»", () => {
  // Нетто-выкупы законно уходят в минус на краю окна: возврат приходит в свою
  // дату и относится к продаже, которой в периоде может не быть. Брутто рядом
  // — единственный способ не принять этот минус за падение продаж.
  const main = page.slice(page.indexOf('id: "main"'), page.indexOf('id: "sales"'));
  assert.match(main, /"buyouts_gross_count", "buyouts_count"/);
  // И только в одной ГРУППЕ — иначе строка нарисуется дважды.
  const groups = page.slice(page.indexOf("const OPTIMA_TABLE_GROUPS"), page.indexOf("const RNP_FILTER_PRESETS_STORAGE_KEY"));
  assert.equal((groups.match(/"buyouts_gross_count"/g) ?? []).length, 1);
});
