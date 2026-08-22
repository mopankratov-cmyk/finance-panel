import assert from "node:assert/strict";
import test from "node:test";
import { buildRkJournalItems } from "./rkJournalRows.ts";

const advert = {
  cabinet_id: "cab-1",
  advert_id: 101,
  bid_type: "manual",
  bid_search_rub: 4.5,
  bid_shelf_rub: null,
};

test("кампании артикула складываются в одну строку своего вида размещения", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: 600, carts: 10, orders: 2, views: 1000, clicks: 50, orders_sum: 5000 },
    { cabinet_id: "cab-1", advert_id: 102, nm_id: 7, date: "2026-08-21", spent: 400, carts: 5, orders: 1, views: 500, clicks: 20, orders_sum: 2500 },
  ], [advert, { ...advert, advert_id: 102 }]);

  assert.equal(items.length, 1);
  assert.equal(items[0].block, "cpc_search");
  const day = items[0].days["2026-08-21"];
  assert.equal(day.spent, 1000);
  assert.equal(day.carts, 15);
  assert.equal(day.orders, 3);
  // Ставка в живом дне — текущая ставка кампании, а не историческая.
  assert.equal(day.bid, 4.5);
  assert.equal(day.snapshot, false);
});

test("кампании разных видов размещения не смешиваются в одну строку", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: 600, carts: 10, orders: 2 },
    { cabinet_id: "cab-1", advert_id: 201, nm_id: 7, date: "2026-08-21", spent: 900, carts: 4, orders: 0 },
  ], [
    advert,
    { cabinet_id: "cab-1", advert_id: 201, bid_type: "manual", bid_search_rub: null, bid_shelf_rub: 210 },
  ]);

  const blocks = items.map((item) => item.block).sort();
  assert.deepEqual(blocks, ["cpc_search", "cpm_shelf"]);
  assert.equal(items.find((item) => item.block === "cpm_shelf")?.days["2026-08-21"].bid, 210);
});

test("кампания без известного вида уходит в «без разметки», а не в чужой блок", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 301, nm_id: 7, date: "2026-08-21", spent: 100, carts: 1, orders: 0 },
  ], [
    { cabinet_id: "cab-1", advert_id: 301, bid_type: "manual", bid_search_rub: 300, bid_shelf_rub: 200 },
  ]);
  assert.equal(items[0].block, "unknown");
});

test("кампания, которой нет в справочнике, не теряет свои затраты", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 999, nm_id: 7, date: "2026-08-21", spent: 250, carts: 3, orders: 1 },
  ], []);
  assert.equal(items.length, 1);
  assert.equal(items[0].block, "unknown");
  assert.equal(items[0].days["2026-08-21"].spent, 250);
});

test("снятый день несёт свою ставку и помечен снимком", () => {
  const items = buildRkJournalItems([
    { date: "2026-08-19", nm_id: 7, block: "cpc_search", bid: 5, spent: 2005, carts: 20, orders: 1, views: 400, clicks: 100, orders_sum: 3000 },
  ], [], [advert]);

  const day = items[0].days["2026-08-19"];
  assert.equal(day.snapshot, true);
  // Ставка того дня, а не сегодняшняя 4.5 из справочника кампаний.
  assert.equal(day.bid, 5);
  assert.equal(day.spent, 2005);
});

test("снимки и живые дни живут в одной строке, каждый со своей пометкой", () => {
  const items = buildRkJournalItems(
    [{ date: "2026-08-19", nm_id: 7, block: "cpc_search", bid: 5, spent: 2005, carts: 20, orders: 1 }],
    [{ cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-22", spent: 700, carts: 8, orders: 2 }],
    [advert],
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].days["2026-08-19"].snapshot, true);
  assert.equal(items[0].days["2026-08-22"].snapshot, false);
  assert.equal(items[0].days["2026-08-22"].bid, 4.5);
});

test("числовые строки из Postgres не превращаются в конкатенацию", () => {
  const items = buildRkJournalItems([], [
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: "600.50", orders_sum: "1200.25", carts: 2, orders: 1 },
    { cabinet_id: "cab-1", advert_id: 101, nm_id: 7, date: "2026-08-21", spent: "399.50", orders_sum: "800.75", carts: 1, orders: 0 },
  ], [advert]);

  assert.equal(items[0].days["2026-08-21"].spent, 1000);
  assert.equal(items[0].days["2026-08-21"].ordersSum, 2001);
});
