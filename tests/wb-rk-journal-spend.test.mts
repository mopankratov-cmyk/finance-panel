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
  assert.match(route, /buildRkJournalItems\(scopedSnapshots, scopedLive, adverts\)/);
  // Решение «какой источник за какой день» принимается на тех же сокращённых
  // строках, что видит сборщик: иначе шапка «снят» разойдётся с цифрами.
  assert.match(route, /chooseRkDaySources\(scopedSnapshots, scopedLive\)/);
});

test("снятый вид размещения сильнее нынешних настроек кампании", () => {
  // Обратное правило стирало полочные дни: WB меняет площадки на живую, и
  // кампания, крутившаяся вчера только на полках, красилась сегодняшним
  // «поиск + полки». Справочник теперь подставляется лишь там, где снимок вида
  // не знал.
  const rows = read("../lib/wb/rkJournalRows.ts");
  assert.match(rows, /isRealBlock\(frozen\) \? frozen : rkAdvertBlock\(advert\) \?\? frozen \?\? WB_RK_BLOCK_UNKNOWN/);
  assert.equal(
    /block: knownBlock \?\? snapshot\.block/.test(rows),
    false,
    "справочник больше не переклеивает историю задним числом",
  );
  // Вид размещения живёт по дням, иначе строка несёт один ярлык на всё окно.
  assert.match(rows, /blockByDate: Map<string, string>/);
});

test("снимок не выдаётся за полный день, пока слой не подтвердил покрытие", () => {
  const rows = read("../lib/wb/rkJournalRows.ts");
  // Сравнение по составу пар, а не по их числу: одинаковый размер при разном
  // составе снова заморозил бы день с чужой кампанией.
  assert.match(rows, /\[\.\.\.\(rawSet \?\? \[\]\)\]\.every\(\(pair\) => snappedSet!\.has\(pair\)\)/);
  const route = read("../app/api/wb/rk-journal/route.ts");
  // Слой читается за ВЕСЬ период, иначе сравнивать снимок не с чем.
  assert.match(route, /\.in\("date", dates\)/);
  assert.equal(
    /const liveDates = dates\.filter\(\(date\) => !snapshotDates\.has\(date\)\)/.test(route),
    false,
    "одна строка снимка больше не закрывает день навсегда",
  );
  // Не прочитался слой — полноту проверить нечем, и об этом говорят вслух.
  assert.match(route, /полноту снятых дней проверить нечем/);
});

test("пустая карточка различает «таких кампаний нет» и «за период не тратили»", () => {
  const page = read("../components/wb/WbRkJournalPage.tsx");
  // Раньше обе причины назывались одинаково — «нет кампаний», — и человек шёл
  // искать свои полки в пустой карточке. Теперь факт наличия вида у кабинета
  // приходит с сервера, а не додумывается на экране.
  assert.match(page, /existsInCabinet: \(data\?\.blocksInCabinet \?\? \[\]\)\.includes\(block\)/);
  assert.match(page, /summary\.existsInCabinet \? "за период не тратили" : "нет таких кампаний"/);
  assert.match(page, /Кампании этого вида у кабинета есть, но за выбранный период они не тратили\./);
  assert.match(page, /не отдал вид размещения/);
  const route = read("../app/api/wb/rk-journal/route.ts");
  assert.match(route, /const blocksInCabinet = \[\.\.\.new Set\(/);
});

test("сводка карточек не зависит от выбранного вида размещения", () => {
  const page = read("../components/wb/WbRkJournalPage.tsx");
  // Сводка считалась по уже отфильтрованным строкам: клик по одной карточке
  // заставлял остальные шесть написать «нет кампаний», хотя те кампании живы.
  assert.match(page, /const blockSummary = useMemo\(\(\) => \{[\s\S]{0,400}?for \(const item of taggedItems\)/);
  assert.match(page, /\}, \[data\?\.blocksInCabinet, taggedItems\]\);/);
  // Вид берётся по дню, иначе кампания, сменившая площадку, попадёт целиком в
  // одну карточку.
  assert.match(page, /const block = campaignBlockAt\(campaign, date\);/);
});

test("конверсии вне карточек названы вслух", () => {
  const page = read("../components/wb/WbRkJournalPage.tsx");
  // Расход в карточках полный, а заказы урезаны: CPO завышался в разы, и
  // красный CPO читался как «дорогая реклама», а не «неполный знаменатель».
  assert.match(page, /const outsideCards = useMemo/);
  assert.match(page, /Вне карточек осталось \{count\(outsideCards\.orders\)\} заказов/);
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
