import assert from "node:assert/strict";
import test from "node:test";
import { buildRkJournalItems } from "./rkJournalRows.ts";

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
