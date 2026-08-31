import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Журнал РК показывал расход больше, чем РНП за тот же день. Причина не в РНП:
 * снимок и сырой слой хранят `spent` по-разному, а читатель применял одну
 * формулу к обоим.
 */

test("читатель различает семантику spent у снимка и у слоя", () => {
  const rows = read("../lib/wb/rkJournalRows.ts");
  assert.match(rows, /function addTo\(cell: RkCell, row: MetricSource, spentIsFull: boolean\)/);
  assert.match(rows, /cell\.spent \+= spentIsFull \? rkNum\(row\.spent\) : rkNum\(row\.spent\) \+ allocated;/);
  assert.match(rows, /addTo\(cell, snapshot, true\);/);
  assert.match(rows, /addTo\(cell, row, false\);/);
  // Снимок действительно кладёт полную сумму — иначе правка выше была бы неверной.
  const sync = read("../app/api/sync/rk-journal/route.ts");
  assert.match(sync, /const spent = num\(row\.spent\) \+ allocated;/);
  assert.match(sync, /spent: Math\.round\(agg\.spent \* 100\) \/ 100,/);
});

test("журнал сужается товарным контуром кабинета, как остальные экраны WB", () => {
  const route = read("../app/api/wb/rk-journal/route.ts");
  assert.match(route, /const allowedNmIds = await requestAllowedNmIds\(cabinetId\);/);
  assert.match(route, /buildRkJournalItems\(inScope\(snapshots\), inScope\(live\), adverts\)/);
});

test("известный вид размещения сильнее замороженного в старом снимке", () => {
  const rows = read("../lib/wb/rkJournalRows.ts");
  assert.match(rows, /if \(row\.block === WB_RK_BLOCK_UNKNOWN && seed\.block !== WB_RK_BLOCK_UNKNOWN\) row\.block = seed\.block;/);
  assert.match(rows, /const knownBlock = advert \? rkAdvertBlock\(advert\) : null;/);
});

test("пустая карточка вида объясняет себя, а не утверждает отсутствие кампаний", () => {
  const page = read("../components/wb/WbRkJournalPage.tsx");
  assert.match(page, /За выбранный период кампаний этого вида не нашлось\./);
  assert.match(page, /не отдал вид размещения/);
  assert.equal(
    /В этом кабинете сейчас нет кампаний такого вида/.test(page),
    false,
    "панель утверждала факт, которого не проверяла",
  );
});

test("синк продаж не перепрыгивает курсор на пустом ответе", () => {
  // Одна осечка WB — и продажи за пропущенные дни не соберутся никогда, а
  // возвраты за те же дни придут: в РНП это выглядит как выкупы в минус.
  const route = read("../app/api/sync/sales/route.ts");
  assert.match(route, /const nextCursor = sales\.length \? statisticsCursor\(sales, dateFrom\) : null;/);
  assert.match(route, /const cursorToWrite = nextCursor \?\? saved\?\.cursor \?\? context\.dateFrom;/);
  assert.equal(
    /: new Date\(Date\.now\(\) - 2 \* 60 \* 60 \* 1000\)\.toISOString\(\)/.test(route),
    false,
    "прыжок вперёд объявлял кабинет догнанным на 100% без единой собранной строки",
  );
});

test("день с возвратами и без единой продажи назван вслух", () => {
  const build = read("../lib/rnp/buildTable.ts");
  assert.match(build, /const salesGapDays = days\.filter/);
  assert.match(build, /продажи за эти дни ещё не собраны/);
  // Отрицательные выкупы не должны молча кормить маржу и среднюю цену выкупа.
  assert.match(build, /qualityReason: salesGapNote \? "unsupported_source" : undefined,/);
});
