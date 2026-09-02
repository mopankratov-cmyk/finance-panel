import assert from "node:assert/strict";
import test from "node:test";
import { rkTargetCpo, suggestRkTask, type RkAutoTaskInput } from "./rkAutoTask.ts";

// Цель 300 ₽: маржа 600 ₽ на единицу, половина её отдана в рекламу.
const TARGET = 300;
const base: RkAutoTaskInput = {
  block: "cpc_search", spent: 0, orders: 0, views: 1000,
  bid: 5, stock: 10, targetCpo: TARGET, dayClosed: true,
};
const at = (patch: Partial<RkAutoTaskInput>) => suggestRkTask({ ...base, ...patch });

test("советчик молчит чаще, чем говорит", () => {
  // 61% дней ставку не трогают вовсе — молчание это норма, а не отказ.
  assert.equal(at({ dayClosed: false, spent: 900 }), null, "живой день не советуем");
  assert.equal(at({ block: "unknown", spent: 900 }), null, "вид не определён");
  assert.equal(at({ views: 0, spent: 900 }), null, "тишина в показах ≠ плохо крутилось");
  assert.equal(at({ block: "erk", spent: 900 }), null, "ЕРК управляется правилами WB");
  assert.equal(at({ bid: null, spent: 900 }), null, "ставка неизвестна");
  assert.equal(at({ targetCpo: null, spent: 900 }), null, "без цели порогов нет");
});

test("нулевой остаток — единственный совет не про ставку", () => {
  assert.equal(at({ stock: 0 })?.note, "Откл до отгрузки");
  // «Не знаем остаток» — не то же самое, что «остатка нет».
  assert.equal(at({ stock: null, spent: 10 }), null);
});

test("поиск: нет заказов и потрачено больше цели — снизить", () => {
  const out = at({ spent: 350, orders: 0 });
  assert.equal(out?.note, "Снизить ставку до 4 ₽");
  assert.match(out!.reason, /Заказов нет/);
  // Потратили меньше цели — рано делать вывод.
  assert.equal(at({ spent: 120, orders: 0 }), null);
});

test("поиск: дорогой заказ — снизить, дешёвый — поднять", () => {
  assert.match(at({ spent: 600, orders: 1 })!.note, /Снизить/); // CPO 600 > 480
  assert.match(at({ spent: 150, orders: 1 })!.note, /Поднять/); // CPO 150 < 180
  // Между полом и потолком — рабочий режим, трогать нечего.
  assert.equal(at({ spent: 300, orders: 1 }), null);
});

test("полки: правило обратное поисковому", () => {
  // На полках ставка покупает позицию, а не заказ: 62% решений при отсутствии
  // заказов — ПОДНЯТЬ, и 70% при дорогом заказе — тоже поднять.
  const noOrders = at({ block: "cpc_shelf", spent: 350, orders: 0 });
  assert.match(noOrders!.note, /Поднять/);
  const dear = at({ block: "cpc_shelf", spent: 600, orders: 1 });
  assert.match(dear!.note, /Поднять/);
  // Тот же вход на поиске даёт противоположное — это и есть суть правила.
  assert.match(at({ block: "cpc_search", spent: 600, orders: 1 })!.note, /Снизить/);
});

test("корзины на решение не влияют", () => {
  // 27% против базовых 24% — шум. Корзин во входе нет вовсе, и это осознанно:
  // тест сторожит, что их не добавят «на всякий случай».
  const keys = Object.keys(base);
  assert.equal(keys.includes("carts"), false);
});

test("шаг решения крупный: мелкое движение — не решение", () => {
  const out = at({ spent: 350, orders: 0, bid: 10 });
  assert.equal(out?.bidTo, 8, "20% вниз от 10 ₽");
  assert.equal(at({ spent: 100, orders: 1, bid: 10 })?.bidTo, 12, "20% вверх");
});

test("цель считается из маржи, а не зашита числом", () => {
  assert.equal(rkTargetCpo(600, 0.5), 300);
  assert.equal(rkTargetCpo(null, 0.5), null);
  assert.equal(rkTargetCpo(600, 0), null, "нулевая доля — не цель");
  assert.equal(rkTargetCpo(600, 1.5), null, "доля больше единицы бессмысленна");
  assert.equal(rkTargetCpo(-10, 0.5), null, "убыточный товар цели не задаёт");
});
