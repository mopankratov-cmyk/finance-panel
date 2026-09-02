import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRkTaskBounds,
  RK_DEFAULT_BOUNDS,
  RK_MAX_SANE_DRR_PCT,
  suggestRkTask,
  type RkAutoTaskInput,
} from "./rkAutoTask.ts";

// Границы СЛОЁНО по августу: ДРР потолок 12%, пол 2%, расход без заказов 1000 ₽.
const base: RkAutoTaskInput = {
  block: "cpc_search", spent: 0, orders: 0, ordersSum: 0, views: 1000,
  bid: 5, stock: 10, bounds: RK_DEFAULT_BOUNDS, dayClosed: true,
};
const at = (patch: Partial<RkAutoTaskInput>) => suggestRkTask({ ...base, ...patch });

test("советчик молчит чаще, чем говорит", () => {
  // 61% дней ставку не трогают вовсе — молчание это норма, а не отказ.
  assert.equal(at({ dayClosed: false, spent: 5000 }), null, "живой день не советуем");
  assert.equal(at({ block: "unknown", spent: 5000 }), null, "вид не определён");
  assert.equal(at({ views: 0, spent: 5000 }), null, "тишина в показах ≠ плохо крутилось");
  assert.equal(at({ block: "erk", spent: 5000 }), null, "ЕРК управляется правилами WB");
  assert.equal(at({ bid: null, spent: 5000 }), null, "ставка неизвестна");
});

test("нулевой остаток — единственный совет не про ставку", () => {
  assert.equal(at({ stock: 0 })?.note, "Откл до отгрузки");
  // «Не знаем остаток» — не то же самое, что «остатка нет».
  assert.equal(at({ stock: null, spent: 10 }), null);
});

test("поиск: нет заказов и расход выше границы кабинета — снизить", () => {
  const out = at({ spent: 1500, orders: 0 });
  assert.equal(out?.note, "Снизить ставку до 4 ₽");
  assert.match(out!.reason, /Заказов нет/);
  // Ниже границы — рано делать вывод: так проходит девять дней из десяти.
  assert.equal(at({ spent: 400, orders: 0 }), null);
});

test("поиск: мера — ДРР, а не рубли", () => {
  // Один и тот же расход при разной выручке значит разное.
  assert.match(at({ spent: 900, orders: 3, ordersSum: 5_000 })!.note, /Снизить/);  // ДРР 18%
  assert.equal(at({ spent: 900, orders: 3, ordersSum: 15_000 }), null);            // ДРР 6% — рабочий режим
  assert.match(at({ spent: 900, orders: 3, ordersSum: 90_000 })!.note, /Поднять/); // ДРР 1% — есть запас
});

test("полки: правило обратное поисковому", () => {
  // На полках ставка покупает позицию, а не заказ: заказов нет — ПОДНЯТЬ,
  // дорого — тоже поднять. Тот же вход на поиске даёт противоположное.
  assert.match(at({ block: "cpc_shelf", spent: 1500, orders: 0 })!.note, /Поднять/);
  // Копейки — не сигнал: прогон по живому дню выдавал «поднять до 247 ₽»
  // при расходе 21 копейка, пока на полках не было нижней границы.
  assert.equal(at({ block: "cpc_shelf", spent: 0.21, orders: 0 }), null);
  assert.match(at({ block: "cpc_shelf", spent: 900, orders: 3, ordersSum: 5_000 })!.note, /Поднять/);
  assert.match(at({ block: "cpc_search", spent: 900, orders: 3, ordersSum: 5_000 })!.note, /Снизить/);
});

test("корзины на решение не влияют", () => {
  // 27% против базовых 24% — шум. Их нет во входе, и это осознанно.
  assert.equal(Object.keys(base).includes("carts"), false);
});

test("шаг решения крупный: мелкое движение — не решение", () => {
  assert.equal(at({ spent: 1500, orders: 0, bid: 10 })?.bidTo, 8, "20% вниз");
  assert.equal(at({ spent: 100, orders: 3, ordersSum: 90_000, bid: 10 })?.bidTo, 12, "20% вверх");
});

test("границы считаются из истории кабинета, а не выдумываются", () => {
  // Ровный ряд: ДРР от 1% до 20%, расходы без заказов от 10 до 2000 ₽.
  const history = [
    ...Array.from({ length: 400 }, (_, i) => ({ spend: 100 + i, orders: 2, ordersSum: (100 + i) / ((1 + (i % 20)) / 100) })),
    ...Array.from({ length: 120 }, (_, i) => ({ spend: 10 + i * 33, orders: 0, ordersSum: 0 })),
  ];
  const bounds = computeRkTaskBounds(history);
  assert.ok(bounds, "истории достаточно");
  assert.ok(bounds!.drrCeilingPct > bounds!.drrFloorPct, "потолок выше пола");
  assert.ok(bounds!.spendWithoutOrder > 0);
  // Пол не должен схлопнуться с потолком у кабинета, где почти всё бесплатно.
  const cheap = Array.from({ length: 400 }, () => ({ spend: 50, orders: 5, ordersSum: 1_000_000 }));
  const cheapBounds = computeRkTaskBounds(cheap);
  assert.ok(cheapBounds!.drrFloorPct >= 0.5, "пол не вырождается в ноль");
});

test("потолок кабинета ограничен здравым смыслом", () => {
  // У кабинета, где реклама систематически съедает больше выручки, 90-й
  // перцентиль ДРР даёт 136% — это не порог, а описание его положения.
  // Живые данные 02.09.2026: COSMOS SHOP 136%, Оптима 64%.
  const awful = Array.from({ length: 400 }, () => ({ spend: 1500, orders: 1, ordersSum: 1000 })); // ДРР 150%
  const bounds = computeRkTaskBounds(awful);
  assert.equal(bounds!.drrCeilingPct, RK_MAX_SANE_DRR_PCT, "выше половины ДРР день убыточен при любой марже");
  assert.ok(bounds!.drrFloorPct < bounds!.drrCeilingPct);
});

test("истории мало — границ нет, а не выдуманные", () => {
  assert.equal(computeRkTaskBounds([]), null);
  assert.equal(computeRkTaskBounds(Array.from({ length: 200 }, () => ({ spend: 100, orders: 1, ordersSum: 1000 }))), null);
});
