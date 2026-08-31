import assert from "node:assert/strict";
import test from "node:test";
import { buildRkJournalItems, chooseRkDaySources, rkDayKey } from "./rkJournalRows.ts";

const advert = {
  cabinet_id: "cab-1",
  advert_id: 101,
  name: "<< СРС тест",
  bid_type: "manual",
  payment_type: "cpc",
  placement_search: true,
  placement_shelf: false,
  bid_search_rub: 4.5,
  bid_shelf_rub: null,
};

test("кампании артикула складываются в его итог, оставаясь раздельными", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: 600, carts: 10, orders: 2, views: 1000, clicks: 50, orders_sum: 5000 },
    { cabinet_id: "cab-1", advert_id: 102, nm_id: 7, date: "2026-08-21", spent: 400, carts: 5, orders: 1, views: 500, clicks: 20, orders_sum: 2500 },
  ], [advert, { ...advert, advert_id: 102 }]);

  assert.equal(items.length, 1);
  assert.equal(items[0].campaigns.length, 2);
  assert.equal(items[0].campaigns[0].block, "cpc_search");
  const day = items[0].days["2026-08-21"];
  assert.equal(day.spent, 1000);
  assert.equal(day.carts, 15);
  assert.equal(day.orders, 3);
  // Ставка живёт на кампании: у артикула их несколько и она разная.
  assert.equal(day.bid, null);
  assert.equal(items[0].campaigns[0].days["2026-08-21"].bid, 4.5);
  assert.equal(day.snapshot, false);
});

test("кампании разных видов размещения не смешиваются между собой", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: 600, carts: 10, orders: 2 },
    { cabinet_id: "cab-1", advert_id: 201, nm_id: 7, date: "2026-08-21", spent: 900, carts: 4, orders: 0 },
  ], [
    advert,
    { cabinet_id: "cab-1", advert_id: 201, bid_type: "manual", payment_type: "cpm", placement_search: false, placement_shelf: true, bid_search_rub: null, bid_shelf_rub: 210 },
  ]);

  // Артикул теперь один, а виды живут на его кампаниях.
  assert.equal(items.length, 1);
  const blocks = items[0].campaigns.map((campaign) => campaign.block).sort();
  assert.deepEqual(blocks, ["cpc_search", "cpm_shelf"]);
  const shelf = items[0].campaigns.find((campaign) => campaign.block === "cpm_shelf");
  assert.equal(shelf?.days["2026-08-21"].bid, 210);
});

test("кампания без известного вида уходит в «без разметки», а не в чужой блок", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 301, nm_id: 7, date: "2026-08-21", spent: 100, carts: 1, orders: 0 },
  ], [
    { cabinet_id: "cab-1", advert_id: 301, bid_type: "manual", bid_search_rub: 90 },
  ]);
  assert.equal(items[0].campaigns[0].block, "unknown");
});

test("кампания, которой нет в справочнике, не теряет свои затраты", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 999, nm_id: 7, date: "2026-08-21", spent: 250, carts: 3, orders: 1 },
  ], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].campaigns[0].block, "unknown");
  assert.equal(items[0].days["2026-08-21"].spent, 250);
});

test("снятый день несёт свою ставку и помечен снимком", () => {
  const items = buildRkJournalItems([
    { date: "2026-08-19", nm_id: 7, advert_id: 101, block: "cpc_search", bid: 5, spent: 2005, carts: 20, orders: 1, views: 400, clicks: 100, orders_sum: 3000 },
  ], [], [advert]);

  const day = items[0].days["2026-08-19"];
  assert.equal(day.snapshot, true);
  assert.equal(day.spent, 2005);
  // Ставка того дня, а не сегодняшняя 4.5 из справочника кампаний.
  assert.equal(items[0].campaigns[0].days["2026-08-19"].bid, 5);
});

test("снимки и живые дни живут в одной строке, каждый со своей пометкой", () => {
  const items = buildRkJournalItems(
    [{ date: "2026-08-19", nm_id: 7, advert_id: 101, block: "cpc_search", bid: 5, spent: 2005, carts: 20, orders: 1 }],
    [{ cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-22", spent: 700, carts: 8, orders: 2 }],
    [advert],
  );

  // Одна и та же кампания: снятый день и живой лежат в её строке.
  assert.equal(items.length, 1);
  assert.equal(items[0].campaigns.length, 1);
  assert.equal(items[0].days["2026-08-19"].snapshot, true);
  assert.equal(items[0].days["2026-08-22"].snapshot, false);
  assert.equal(items[0].campaigns[0].days["2026-08-22"].bid, 4.5);
});

test("числовые строки из Postgres не превращаются в конкатенацию", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: "600.50", orders_sum: "1200.25", carts: 2, orders: 1 },
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: "399.50", orders_sum: "800.75", carts: 1, orders: 0 },
  ], [advert]);

  assert.equal(items[0].days["2026-08-21"].spent, 1000);
  assert.equal(items[0].days["2026-08-21"].ordersSum, 2001);
});

test("разложенный расход входит в затраты строки и остаётся видимым отдельно", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-22", spent: 0, spent_allocated: 569.74, carts: 3, orders: 1, views: 700 },
  ], [advert]);

  const day = items[0].days["2026-08-22"];
  // Раньше здесь был ноль при живых корзинах — WB не разнёс расход по nm.
  assert.equal(day.spent, 569.74);
  assert.equal(day.spentAllocated, 569.74);
});

test("измеренное и разложенное складываются, а не подменяют друг друга", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-22", spent: 400, spent_allocated: 100, carts: 2, orders: 1 },
    { cabinet_id: "cab-1", advert_id: 102, nm_id: 7, date: "2026-08-22", spent: 50, spent_allocated: 0, carts: 1, orders: 0 },
  ], [advert, { ...advert, advert_id: 102 }]);

  const day = items[0].days["2026-08-22"];
  assert.equal(day.spent, 550);
  assert.equal(day.spentAllocated, 100);
});

test("строки без раскладки не получают лишних денег", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-22", spent: 300, carts: 2, orders: 1 },
  ], [advert]);
  assert.equal(items[0].days["2026-08-22"].spent, 300);
  assert.equal(items[0].days["2026-08-22"].spentAllocated, 0);
});

test("снимок помнит, какой кампании принадлежит день", () => {
  const items = buildRkJournalItems([
    { date: "2026-08-21", nm_id: 7, advert_id: 101, block: "cpc_search", bid: 5, spent: 900, carts: 4, orders: 1 },
    { date: "2026-08-21", nm_id: 7, advert_id: 201, block: "cpm_shelf", bid: 210, spent: 100, carts: 1, orders: 0 },
  ], [], [advert]);

  assert.equal(items.length, 1);
  assert.equal(items[0].campaigns.length, 2);
  assert.equal(items[0].days["2026-08-21"].spent, 1000);
  // Кампании отсортированы по расходу: сверху та, что съела больше.
  assert.equal(items[0].campaigns[0].advertId, 101);
  assert.equal(items[0].campaigns[0].name, "<< СРС тест");
});

test("день артикула снят, только когда сняты все его кампании", () => {
  const items = buildRkJournalItems(
    [{ date: "2026-08-22", nm_id: 7, advert_id: 101, block: "cpc_search", bid: 5, spent: 100, carts: 1, orders: 0 }],
    [{ cabinet_id: "cab-1", advert_id: 201, nm_id: 7, date: "2026-08-22", spent: 50, carts: 1, orders: 0 }],
    [advert, { cabinet_id: "cab-1", advert_id: 201, bid_type: "manual", payment_type: "cpm", placement_shelf: true }],
  );
  assert.equal(items[0].days["2026-08-22"].snapshot, false);
});

test("чужая кампания без показов не становится кампанией артикула", () => {
  // WB приписал заказ кампании соседнего товара: показов и расхода по нашему
  // артикулу у неё нет. В кабинете это отдельная строка «Конверсии из других
  // кампаний», а не полноценная кампания.
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: 600, views: 900, clicks: 20, carts: 5, orders: 2 },
    { cabinet_id: "cab-1", advert_id: 777, nm_id: 7, date: "2026-08-21", spent: 0, views: 0, clicks: 0, carts: 1, orders: 1 },
  ], [advert, { cabinet_id: "cab-1", advert_id: 777, name: "чужая 846/розовая", bid_type: "manual", payment_type: "cpc", placement_search: true }]);

  const blocks = items[0].campaigns.map((campaign) => campaign.block);
  assert.deepEqual(blocks, ["cpc_search", "attributed"]);
  // Итог артикула по-прежнему включает перенесённый заказ.
  assert.equal(items[0].days["2026-08-21"].orders, 3);
  assert.equal(items[0].campaigns[1].days["2026-08-21"].orders, 1);
});

test("кампания без единой цифры по артикулу не показывается вовсе", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: 600, views: 900, carts: 5, orders: 2 },
    { cabinet_id: "cab-1", advert_id: 888, nm_id: 7, date: "2026-08-21", spent: 0, views: 0, clicks: 0, carts: 0, orders: 0 },
  ], [advert, { cabinet_id: "cab-1", advert_id: 888, name: "пустая", bid_type: "manual", payment_type: "cpc", placement_search: true }]);

  assert.equal(items[0].campaigns.length, 1);
  assert.equal(items[0].campaigns[0].advertId, 101);
});

test("артикул, у которого вообще нет живых кампаний, из журнала уходит", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 888, nm_id: 9, date: "2026-08-21", spent: 0, views: 0, clicks: 0, carts: 0, orders: 0 },
  ], [{ cabinet_id: "cab-1", advert_id: 888, name: "пустая", bid_type: "manual", payment_type: "cpc", placement_search: true }]);
  assert.deepEqual(items, []);
});

test("кампания со своим артикулом в составе остаётся его кампанией и без показов в окне", () => {
  // Крутилась раньше выбранного окна, заказ пришёл внутри него: в «конверсии
  // из других кампаний» ей нельзя — WB держит артикул в её составе.
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: 0, views: 0, clicks: 0, carts: 1, orders: 1 },
  ], [{ ...advert, nm_ids: [7, 8] }]);

  assert.equal(items[0].campaigns.length, 1);
  assert.equal(items[0].campaigns[0].block, "cpc_search");
  assert.equal(items[0].campaigns[0].nmCount, 2);
});

test("разложенный расход из снимка не считается дважды", () => {
  // Снимок кладёт в spent УЖЕ полную сумму и дублирует разложенное рядом
  // «на память». Формула сырого слоя (spent + allocated) на снятом дне давала
  // двойной счёт: по карточке, где WB не разнёс расход вовсе, — ровно вдвое.
  const items = buildRkJournalItems(
    [{
      cabinet_id: "cab", date: "2026-08-26", nm_id: 111, advert_id: 5, block: "cpc_search",
      bid: 100, views: 100, clicks: 10, spent: 569.74, spent_allocated: 569.74,
      carts: 1, orders: 0, orders_sum: 0,
    }],
    [],
    [{ advert_id: 5, cabinet_id: "cab", name: "РК", payment_type: "cpc", placement_search: true, placement_shelf: false, bid_search_rub: 100, bid_shelf_rub: null, bid_cpm_rub: 100, block_override: null, nm_ids: [111] }],
  );
  const cell = items[0].campaigns[0].days["2026-08-26"];
  assert.equal(cell.spent, 569.74);
  assert.equal(cell.spentAllocated, 569.74);
});

test("сырой слой по-прежнему складывает измеренное и разложенное", () => {
  const items = buildRkJournalItems(
    [],
    [{
      cabinet_id: "cab", advert_id: 5, nm_id: 111, date: "2026-08-27",
      views: 100, clicks: 10, spent: 0, spent_allocated: 569.74, carts: 1, orders: 0, orders_sum: 0,
    }],
    [{ advert_id: 5, cabinet_id: "cab", name: "РК", payment_type: "cpc", placement_search: true, placement_shelf: false, bid_search_rub: 100, bid_shelf_rub: null, bid_cpm_rub: 100, block_override: null, nm_ids: [111] }],
  );
  assert.equal(items[0].campaigns[0].days["2026-08-27"].spent, 569.74);
});

test("вид размещения из справочника сильнее замороженного в снимке", () => {
  // Снимок сделан в 06:00, когда WB ещё не отдал настройки кампании: вид
  // остался «не определён». Живой справочник знает, что это полки — карточка
  // «CPC полки» больше не пишет «нет кампаний».
  const items = buildRkJournalItems(
    [{
      cabinet_id: "cab", date: "2026-08-26", nm_id: 111, advert_id: 7, block: "unknown",
      bid: 50, views: 10, clicks: 1, spent: 40, spent_allocated: 0, carts: 0, orders: 0, orders_sum: 0,
    }],
    [],
    [{ advert_id: 7, cabinet_id: "cab", name: "Полки", payment_type: "cpc", placement_search: false, placement_shelf: true, bid_search_rub: null, bid_shelf_rub: 50, bid_cpm_rub: 50, block_override: null, nm_ids: [111] }],
  );
  assert.equal(items[0].campaigns[0].block, "cpc_shelf");
});

// ── Неполный снимок 06:00 ────────────────────────────────────────────────────

test("снимок, знающий меньше слоя, уступает ему метрики дня", () => {
  // Синк статистики обходит кампании срезами: к 06:00 в слой доехала только
  // часть кабинета, и снимок заморозил утренний огрызок. Раньше одной строки
  // снимка хватало, чтобы день считался закрытым навсегда, и экран показывал
  // пятую часть расхода.
  const items = buildRkJournalItems(
    [{ cabinet_id: "cab", date: "2026-08-27", nm_id: 7, advert_id: 101, block: "cpc_search", bid: 4.5, spent: 100, views: 10, clicks: 1 }],
    [
      { cabinet_id: "cab", advert_id: 101, nm_id: 7, date: "2026-08-27", spent: 100, views: 10, clicks: 1 },
      { cabinet_id: "cab", advert_id: 909, nm_id: 7, date: "2026-08-27", spent: 400, views: 40, clicks: 4 },
    ],
    [advert],
  );
  const day = items[0].days["2026-08-27"];
  assert.equal(day.spent, 500, "поздняя кампания обязана попасть в день");
  assert.equal(day.snapshot, false, "день, дособранный из слоя, снятым не считается");
});

test("полный снимок остаётся источником и не задваивается слоем", () => {
  const items = buildRkJournalItems(
    [{ cabinet_id: "cab", date: "2026-08-27", nm_id: 7, advert_id: 101, block: "cpc_search", bid: 4.5, spent: 100, views: 10, clicks: 1 }],
    [{ cabinet_id: "cab", advert_id: 101, nm_id: 7, date: "2026-08-27", spent: 100, views: 10, clicks: 1 }],
    [advert],
  );
  const day = items[0].days["2026-08-27"];
  assert.equal(day.spent, 100);
  assert.equal(day.snapshot, true);
  assert.equal(items[0].campaigns[0].days["2026-08-27"].bid, 4.5, "ставка того дня живёт только в снимке");
});

test("строку, потерянную слоем, снимок доносит сам", () => {
  const items = buildRkJournalItems(
    [
      { cabinet_id: "cab", date: "2026-08-27", nm_id: 7, advert_id: 101, block: "cpc_search", bid: 4.5, spent: 100 },
      { cabinet_id: "cab", date: "2026-08-27", nm_id: 7, advert_id: 777, block: "cpc_search", bid: 3, spent: 70 },
    ],
    [
      { cabinet_id: "cab", advert_id: 101, nm_id: 7, date: "2026-08-27", spent: 100 },
      { cabinet_id: "cab", advert_id: 909, nm_id: 7, date: "2026-08-27", spent: 400 },
    ],
    [advert],
  );
  assert.equal(items[0].days["2026-08-27"].spent, 570, "100 из слоя + 400 из слоя + 70 только из снимка");
});

// ── Вид размещения по дням ───────────────────────────────────────────────────

test("снятый вид размещения сильнее нынешних настроек кампании", () => {
  // WB меняет площадки на живую. 29-го кампания крутилась только на полках,
  // 30-го к ним добавился поиск. Красить оба дня сегодняшними настройками
  // значит стирать полочный день из карточки «CPC полки».
  const shelfThenBoth = { ...advert, advert_id: 55, placement_search: true, placement_shelf: true, bid_shelf_rub: 4.45 };
  const items = buildRkJournalItems(
    [
      { cabinet_id: "cab-1", date: "2026-08-29", nm_id: 7, advert_id: 55, block: "cpc_shelf", bid: 4.45, spent: 2781, views: 13601, clicks: 631 },
      { cabinet_id: "cab-1", date: "2026-08-30", nm_id: 7, advert_id: 55, block: "cpc_both", bid: 4.35, spent: 900, views: 4000, clicks: 200 },
    ],
    [],
    [shelfThenBoth],
  );
  const campaign = items[0].campaigns[0];
  assert.equal(campaign.blocks?.["2026-08-29"], "cpc_shelf");
  assert.equal(campaign.blocks?.["2026-08-30"], "cpc_both");
  assert.equal(campaign.block, "cpc_shelf", "подпись строки — вид, сжёгший больше денег (2781 ₽ против 900 ₽)");
});

test("вид размещения по дням не заводится, пока он не менялся", () => {
  const items = buildRkJournalItems(
    [{ cabinet_id: "cab-1", date: "2026-08-29", nm_id: 7, advert_id: 101, block: "cpc_search", bid: 4.5, spent: 100 }],
    [],
    [advert],
  );
  assert.equal(items[0].campaigns[0].blocks, undefined, "лишний словарь по дням в ответ не едет");
});

test("вторая ставка «поиск + полки» не теряется", () => {
  const both = { ...advert, advert_id: 60, placement_shelf: true, bid_search_rub: 5, bid_shelf_rub: 5.5 };
  const items = buildRkJournalItems(
    [],
    [{ cabinet_id: "cab-1", advert_id: 60, nm_id: 7, date: "2026-08-31", spent: 300, views: 100, clicks: 10 }],
    [both],
  );
  const cell = items[0].campaigns[0].days["2026-08-31"];
  assert.equal(cell.bid, 5, "основная ставка — поисковая");
  assert.equal(cell.bidAlt, 5.5, "полочная ставка обязана быть видна рядом");
});

test("равные ставки второй строкой не дублируются", () => {
  const erk = { ...advert, advert_id: 61, bid_type: "unified", payment_type: "cpm", placement_shelf: true, bid_search_rub: 148, bid_shelf_rub: 148 };
  const items = buildRkJournalItems(
    [],
    [{ cabinet_id: "cab-1", advert_id: 61, nm_id: 7, date: "2026-08-31", spent: 300, views: 100, clicks: 10 }],
    [erk],
  );
  assert.equal(items[0].campaigns[0].days["2026-08-31"].bidAlt, null);
});

// ── Ревью: двойной счёт и решение об источнике ───────────────────────────────

test("снимок без advert_id за живой день не задваивает расход", () => {
  // Роут перечитывает снимки БЕЗ advert_id, пока миграция не применена.
  // Ключ пропуска включал кампанию, а ячейки копятся по «артикул|кампания» —
  // такая строка заводила себе вторую и удваивала день.
  const items = buildRkJournalItems(
    [{ cabinet_id: "cab", date: "2026-08-27", nm_id: 7, advert_id: null, block: "cpc_search", bid: 4.5, spent: 100 }],
    [
      { cabinet_id: "cab", advert_id: 101, nm_id: 7, date: "2026-08-27", spent: 100 },
      { cabinet_id: "cab", advert_id: 909, nm_id: 7, date: "2026-08-27", spent: 400 },
    ],
    [advert],
  );
  assert.equal(items[0].days["2026-08-27"].spent, 500, "снимок без кампании за живой день молчит");
});

test("рассинхрон cabinet_id между снимком и слоем не задваивает расход", () => {
  const items = buildRkJournalItems(
    [{ cabinet_id: null, date: "2026-08-27", nm_id: 7, advert_id: 101, block: "cpc_search", bid: 4.5, spent: 100 }],
    [
      { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-27", spent: 100 },
      { cabinet_id: "cab-1", advert_id: 909, nm_id: 7, date: "2026-08-27", spent: 400 },
    ],
    [advert],
  );
  assert.equal(items[0].days["2026-08-27"].spent, 500);
});

test("неполный день одного кабинета не размораживает день соседнего", () => {
  // Решение об источнике принимается на пару «кабинет + дата». Раньше оно было
  // общим на дату, и один отстающий кабинет снимал пометку «снят» со всех.
  const { snapshotDates, covered } = chooseRkDaySources(
    [
      { cabinet_id: "A", date: "2026-08-27", nm_id: 1, advert_id: 11, block: "cpc_search", bid: 5, spent: 10 },
      { cabinet_id: "B", date: "2026-08-27", nm_id: 2, advert_id: 22, block: "cpc_search", bid: 5, spent: 10 },
    ],
    [
      { cabinet_id: "A", advert_id: 11, nm_id: 1, date: "2026-08-27", spent: 10 },
      { cabinet_id: "B", advert_id: 22, nm_id: 2, date: "2026-08-27", spent: 10 },
      { cabinet_id: "B", advert_id: 33, nm_id: 2, date: "2026-08-27", spent: 90 },
    ],
    );
  assert.equal(covered.has(rkDayKey("A", "2026-08-27")), true, "у кабинета A день снят целиком");
  assert.equal(covered.has(rkDayKey("B", "2026-08-27")), false, "у кабинета B слой знает больше");
  assert.deepEqual(snapshotDates, [], "в шапке день снят, только если снят у всех");
});

test("ручная разметка владельца сильнее снятого вида", () => {
  const overridden = { ...advert, advert_id: 70, block_override: "cpm_shelf" };
  const items = buildRkJournalItems(
    [{ cabinet_id: "cab-1", date: "2026-08-27", nm_id: 7, advert_id: 70, block: "cpc_search", bid: 5, spent: 100 }],
    [],
    [overridden],
  );
  assert.equal(items[0].campaigns[0].block, "cpm_shelf");
});

test("известный вид добивает неизвестный внутри одной кампании", () => {
  // Кампании нет в справочнике; вид известен только за день со снимком.
  // Раньше строка распадалась на свою карточку и «Вид не определён».
  const items = buildRkJournalItems(
    [{ cabinet_id: "cab", date: "2026-08-27", nm_id: 7, advert_id: 500, block: "cpm_shelf", bid: 200, spent: 100 }],
    [{ cabinet_id: "cab", advert_id: 500, nm_id: 7, date: "2026-08-28", spent: 300 }],
    [],
  );
  const campaign = items[0].campaigns[0];
  assert.equal(campaign.blocks, undefined, "оба дня свелись к одному виду");
  assert.equal(campaign.block, "cpm_shelf");
});

test("вторая ставка не показывается рядом с замороженной", () => {
  // Слева была бы ставка того дня из снимка, справа — сегодняшняя из
  // справочника: две разные даты в одной ячейке.
  const both = { ...advert, advert_id: 60, placement_shelf: true, bid_search_rub: 5, bid_shelf_rub: 5.5 };
  const items = buildRkJournalItems(
    [
      { cabinet_id: "cab-1", date: "2026-08-31", nm_id: 7, advert_id: 60, block: "cpc_both", bid: 4.2, spent: 10 },
      { cabinet_id: "cab-1", date: "2026-08-31", nm_id: 8, advert_id: 60, block: "cpc_both", bid: 4.2, spent: 10 },
    ],
    [
      { cabinet_id: "cab-1", advert_id: 60, nm_id: 7, date: "2026-08-31", spent: 10 },
      { cabinet_id: "cab-1", advert_id: 61, nm_id: 7, date: "2026-08-31", spent: 300 },
    ],
    [both],
  );
  const cell = items.find((item) => item.nm === 7)!.campaigns.find((c) => c.advertId === 60)!.days["2026-08-31"];
  assert.equal(cell.bid, 4.2, "ставка того дня — из снимка");
  assert.equal(cell.bidAlt, null, "вторая ставка из сегодняшнего справочника рядом не рисуется");
});
