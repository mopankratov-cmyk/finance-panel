import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { STATISTICS_OVERLAP_HOURS, statisticsCursor, statisticsRequestCursor } from "../lib/wb/syncRecovery";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Проверено на живом кабинете 31.08.2026: у Retail Family с 21.08 не было НИ
 * ОДНОЙ продажи по всем 64 товарам, при живых заказах (по 200+ в день) и
 * приходящих возвратах по тем же товарам. Возврат — событие «сейчас», его
 * lastChangeDate свежий; продажу WB публикует задним числом, и её
 * lastChangeDate оказывается старше уже сохранённого курсора.
 */

test("курсор — это максимальный lastChangeDate ответа", () => {
  const cursor = statisticsCursor(
    [{ lastChangeDate: "2026-08-30T10:00:00" }, { lastChangeDate: "2026-08-31T09:00:00" }],
    "2026-08-01T00:00:00",
  );
  assert.equal(cursor, "2026-08-31T09:00:00");
  // Строка, опубликованная позже с более старой датой изменения, при запросе
  // «строго от курсора» уже не вернётся — отсюда и дыра.
  assert.ok("2026-08-30T23:00:00" < cursor);
});

test("запрос уходит с перехлёстом назад, а не строго от курсора", () => {
  assert.equal(STATISTICS_OVERLAP_HOURS, 48);
  assert.equal(statisticsRequestCursor("2026-08-31T09:00:00"), "2026-08-29T09:00:00");
  // Мусорный курсор не должен превращаться в NaN-дату.
  assert.equal(statisticsRequestCursor("не дата"), "не дата");
});

test("синки продаж и заказов спрашивают WB с перехлёстом", () => {
  for (const path of ["../app/api/sync/sales/route.ts", "../app/api/sync/orders/route.ts"]) {
    const route = read(path);
    assert.match(route, /const requestFrom = forceFrom \? dateFrom : statisticsRequestCursor\(dateFrom\);/, path);
    assert.match(route, /url\.searchParams\.set\("dateFrom", requestFrom\);/, path);
  }
});
