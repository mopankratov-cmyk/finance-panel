import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { summarizeUnitRows } from "../lib/unit/summary";

/**
 * Сводка юнита показывала прибыль как «маржа с единицы × заказы». Ставки
 * удержаний WB выведены от суммы продаж, поэтому маржа относится к выкупленной
 * единице: при выкупе 60% прибыль на экране была завышена в полтора раза.
 */

test("прибыль считается по выкупам, а не по заказам", () => {
  const summary = summarizeUnitRows([
    { revenue: 100_000, orders: 100, buyoutPct: 60, marginUnit: 200, ad: 0, cost: 500 },
  ]);
  assert.equal(summary.buyouts, 60);
  assert.equal(summary.profit, 12_000, "200 ₽ × 60 выкупов, а не × 100 заказов");
  assert.equal(summary.buyoutRevenue, 60_000);
  assert.equal(summary.ordersRevenue, 100_000, "выручка заказов остаётся видна отдельно");
});

test("реклама вычитается целиком, а не в доле выкупов", () => {
  // Маржа/ед в таблице уже за вычетом рекламы на заказ: 300 − 10 000/100 = 200.
  const summary = summarizeUnitRows([
    { revenue: 100_000, orders: 100, buyoutPct: 50, marginUnit: 200, ad: 10_000, cost: 500 },
  ]);
  // Правильно: 300 × 50 − 10 000 = 5 000. Наивное «маржа × выкупы» дало бы
  // 200 × 50 = 10 000, то есть вернуло бы половину рекламного расхода.
  assert.equal(summary.profit, 5_000);
});

test("маржа в процентах считается от выручки выкупов", () => {
  const summary = summarizeUnitRows([
    { revenue: 100_000, orders: 100, buyoutPct: 50, marginUnit: 200, ad: 0, cost: 500 },
  ]);
  assert.equal(summary.marginPct, 20, "10 000 прибыли на 50 000 выкупленной выручки");
});

test("строка без посчитанной маржи не размывает процент и не приносит прибыль", () => {
  const summary = summarizeUnitRows([
    { revenue: 100_000, orders: 100, buyoutPct: 50, marginUnit: 200, ad: 0, cost: 500 },
    { revenue: 900_000, orders: 900, buyoutPct: 50, marginUnit: null, ad: 0, cost: null },
  ]);
  assert.equal(summary.profit, 10_000);
  assert.equal(summary.marginPct, 20, "выручка строки без себестоимости в знаменатель не входит");
  assert.equal(summary.costKnown, 1);
  assert.equal(summary.buyoutRevenue, 500_000, "выручка выкупов при этом считается по всем строкам");
});

test("нулевые заказы не роняют расчёт", () => {
  const summary = summarizeUnitRows([
    { revenue: 0, orders: 0, buyoutPct: null, marginUnit: null, ad: 0, cost: null },
  ]);
  assert.equal(summary.profit, 0);
  assert.equal(summary.marginPct, null);
  assert.equal(summary.buyouts, 0);
});

test("реклама без единого выкупа — это чистый убыток периода", () => {
  const summary = summarizeUnitRows([
    { revenue: 50_000, orders: 50, buyoutPct: 0, marginUnit: 100, ad: 3_000, cost: 400 },
  ]);
  assert.equal(summary.profit, -3_000, "заказы есть, выкупов нет — потрачена только реклама");
});

test("экран юнита берёт сводку из общей функции и читает пустые ячейки как «нет данных»", () => {
  const page = readFileSync(new URL("../components/wb/WbUnitPage.tsx", import.meta.url), "utf8");
  assert.match(page, /summarizeUnitRows/);
  assert.equal(
    /profit \+= marginUnit \* orders/.test(page),
    false,
    "прибыль по заказам возвращаться не должна",
  );
  // Number("") === 0: пустая ячейка молча становилась нулевой маржой и тянула
  // свою выручку в знаменатель процента.
  assert.match(page, /if \(raw === "" \|\| raw == null\) return null;/);
});
