import assert from "node:assert/strict";
import test from "node:test";
import { wbAdvertBlock, wbAdvertBlockBid } from "./advertBlocks.ts";
import { cplTone, cpoTone, costPerCart, costPerOrder } from "./rkThresholds.ts";
import { moscowToday, moscowYesterday } from "./rkJournalDates.ts";

test("единая ставка — это ЕРК независимо от размера ставки", () => {
  assert.equal(wbAdvertBlock({ bid_type: "unified", bid_search_rub: 415 }), "erk");
  assert.equal(wbAdvertBlock({ bid_type: "unified", bid_search_rub: 5.36 }), "erk");
});

test("живая ставка одна: поиск и полки разводятся, модель оплаты — по порядку ставки", () => {
  assert.equal(wbAdvertBlock({ bid_type: "manual", bid_search_rub: 4.61, bid_shelf_rub: 0 }), "cpc_search");
  assert.equal(wbAdvertBlock({ bid_type: "manual", bid_search_rub: 2000, bid_shelf_rub: null }), "cpm_search");
  assert.equal(wbAdvertBlock({ bid_type: "manual", bid_search_rub: 0, bid_shelf_rub: 6.8 }), "cpc_shelf");
  assert.equal(wbAdvertBlock({ bid_type: "manual", bid_search_rub: null, bid_shelf_rub: 210 }), "cpm_shelf");
});

test("две живые ставки или ставка в серой зоне — размечает владелец, а не автоматика", () => {
  assert.equal(wbAdvertBlock({ bid_type: "manual", bid_search_rub: 300, bid_shelf_rub: 200 }), null);
  assert.equal(wbAdvertBlock({ bid_type: "manual", bid_search_rub: 90, bid_shelf_rub: null }), null);
  assert.equal(wbAdvertBlock({ bid_type: "manual" }), null);
  assert.equal(wbAdvertBlock({ bid_type: "unknown", bid_search_rub: null, bid_shelf_rub: null }), null);
});

test("ручная разметка сильнее любых ставок", () => {
  assert.equal(wbAdvertBlock({ bid_type: "unified", bid_search_rub: 415, block_override: "cpm_shelf" }), "cpm_shelf");
  assert.equal(wbAdvertBlock({ bid_type: "manual", bid_search_rub: 300, bid_shelf_rub: 200, block_override: "cpc_search" }), "cpc_search");
});

test("в строке журнала показываем ставку того размещения, к которому она относится", () => {
  const advert = { bid_search_rub: 4.5, bid_shelf_rub: 210 };
  assert.equal(wbAdvertBlockBid(advert, "cpc_search"), 4.5);
  assert.equal(wbAdvertBlockBid(advert, "cpm_shelf"), 210);
  // Старые строки знают только ставку поиска — она и остаётся фолбэком.
  assert.equal(wbAdvertBlockBid({ bid_cpm_rub: 148 }, "cpm_search"), 148);
});

test("пороги владельца: 300/400 по CPO и 60/80 по CPL, границы включительно", () => {
  assert.equal(cpoTone(300), "green");
  assert.equal(cpoTone(300.01), "amber");
  assert.equal(cpoTone(400), "amber");
  assert.equal(cpoTone(402.4), "red");
  assert.equal(cplTone(60), "green");
  assert.equal(cplTone(65.58), "amber");
  assert.equal(cplTone(100.25), "red");
});

test("день без расхода не выдаёт себя за идеальную эффективность", () => {
  // Показы были, расход нулевой: CPO 0,00 в зелёной заливке читался бы как
  // «заказы даром», хотя рекламы фактически не крутилось.
  assert.equal(costPerOrder(0, 1), null);
  assert.equal(costPerCart(0, 2), null);
  assert.equal(cpoTone(costPerOrder(0, 1)), null);
});

test("расход без результата не красится зелёным, а честно молчит", () => {
  assert.equal(costPerOrder(2100, 0), null);
  assert.equal(costPerCart(644, 0), null);
  assert.equal(cpoTone(costPerOrder(2100, 0)), null);
  // Строка из листа владельца: 619 ₽ / 3 заказа = 206,33 — зелёная.
  assert.equal(Math.round((costPerOrder(619, 3) as number) * 100) / 100, 206.33);
  assert.equal(cpoTone(costPerOrder(619, 3)), "green");
  assert.equal(Math.round((costPerCart(619, 17) as number) * 100) / 100, 36.41);
});

test("снимок в 06:00 МСК берёт вчерашний московский день, а не позавчерашний", () => {
  // 03:00 UTC 22.08 = 06:00 МСК 22.08 → снимаем 21.08.
  assert.equal(moscowYesterday(new Date("2026-08-22T03:00:00Z")), "2026-08-21");
  // 22:30 UTC 21.08 — по Москве уже 22.08, вчера = 21.08.
  assert.equal(moscowYesterday(new Date("2026-08-21T22:30:00Z")), "2026-08-21");
  assert.equal(moscowToday(new Date("2026-08-21T22:30:00Z")), "2026-08-22");
});
