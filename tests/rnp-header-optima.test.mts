import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  aggregateRnpWeekly,
  isBurnedOutSku,
  rnpLossReasons,
  rnpWeekBuckets,
} from "../lib/rnp/operatingMatrix";

// Шапка РНП в духе «Рука на пульсе»: недельная гранулярность и операционные
// фильтры «Без сгоревших» / «Потери». Правила агрегации важны для честности:
// суммы складываются, проценты нельзя пересчитать из сумм — среднее по дням.

test("недельные корзины: ISO-недели пн–вс, подписи и «идёт» для текущей", () => {
  // 2026-08-11 — вторник; 14 дней: вт–вс (6), пн–вс (7), пн (1).
  const buckets = rnpWeekBuckets("2026-08-11", 14, "2026-08-24");
  assert.equal(buckets.length, 3);
  assert.deepEqual(buckets.map((bucket) => bucket.indexes.length), [6, 7, 1]);
  assert.equal(buckets[0].label, "11.08–16.08");
  assert.equal(buckets[1].label, "17.08–23.08");
  assert.equal(buckets[0].period_type, "неделя");
  // Сегодня (24.08) попадает в третью корзину — она «идёт», недобор не читается как падение.
  assert.equal(buckets[2].period_type, "идёт");
  assert.equal(buckets[2].label, "24.08");
});

test("недельная агрегация: суммы складываются, проценты — среднее, null не превращается в ноль", () => {
  const table = {
    period: Array.from({ length: 14 }, (_, i) => ({ label: `d${i}`, period_type: "день" })),
    summary: [
      { field: "orders_count", kind: "int", daily: [1, 2, 3, null, 5, 6, 7, 10, 10, 10, 10, 10, 10, 10], total: 94 },
      { field: "buyout_pct", kind: "pct", daily: [50, 100, null, null, null, null, null, ...Array(7).fill(null)], total: 75 },
      { field: "gross", kind: "money", daily: Array(14).fill(null), total: null },
    ],
    skus: [{ metrics: [{ field: "orders_count", kind: "int", daily: Array(14).fill(1), total: 14 }] }],
  };
  const weekly = aggregateRnpWeekly(table, "2026-08-11", "2026-08-24");
  assert.equal(weekly.period.length, 3);
  // int: сумма по дням с данными (null выпадает из суммы, не превращаясь в 0).
  assert.deepEqual(weekly.summary[0].daily, [1 + 2 + 3 + 5 + 6, 7 + 10 * 6, 10]);
  // pct: среднее по дням с данными.
  assert.equal(weekly.summary[1].daily[0], 75);
  assert.equal(weekly.summary[1].daily[1], null);
  // Полностью пустая метрика остаётся пустой.
  assert.deepEqual(weekly.summary[2].daily, [null, null, null]);
  // Итоги за период не трогаем — они не зависят от гранулярности.
  assert.equal(weekly.summary[0].total, 94);
  assert.equal(weekly.skus[0].metrics[0].daily.length, 3);
});

const metric = (field: string, total: number | null, daily: (number | null)[] = []) =>
  ({ field, total, daily });

test("«сгоревший» — ноль заказов И ноль остатка; неизвестность — не смерть", () => {
  assert.equal(isBurnedOutSku([metric("orders_count", 0), metric("stock_total", 0)]), true);
  assert.equal(isBurnedOutSku([metric("orders_count", 5), metric("stock_total", 0)]), false);
  assert.equal(isBurnedOutSku([metric("orders_count", 0), metric("stock_total", 3)]), false);
  // Остаток неизвестен (null) — не считаем сгоревшим: нет данных ≠ нет остатка.
  assert.equal(isBurnedOutSku([metric("orders_count", 0), metric("stock_total", null)]), false);
  // total пуст, но последний дневной срез знает остаток.
  assert.equal(isBurnedOutSku([metric("orders_count", 0), metric("stock_total", null, [4, null])]), false);
  assert.equal(isBurnedOutSku([metric("orders_count", 0), metric("stock_total", null, [null, 0])]), true);
});

test("«потери»: минус по прибыли, реклама без заказов, ноль остатка при спросе", () => {
  assert.deepEqual(
    rnpLossReasons([metric("net_profit", -100), metric("orders_count", 3), metric("stock_total", 5)]),
    ["чистая прибыль в минусе"],
  );
  assert.deepEqual(
    rnpLossReasons([metric("ad_spent", 500), metric("orders_count", 0), metric("stock_total", 5)]),
    ["реклама крутится без заказов"],
  );
  assert.deepEqual(
    rnpLossReasons([metric("orders_count", 7), metric("stock_total", 0)]),
    ["остаток кончился при живом спросе"],
  );
  assert.deepEqual(rnpLossReasons([metric("orders_count", 3), metric("stock_total", 10), metric("net_profit", 50)]), []);
});

test("шапка собрана: блоки Данные/Показ, чипы и обвязка на странице", async () => {
  const toolbar = await readFile(new URL("../components/wb/RnpOperatingToolbar.tsx", import.meta.url), "utf8");
  for (const marker of ["Данные", "Показ", "Без сгоревших", "Потери", "Аномалии", "День", "Неделя", "± цифры", "Окно оборач.", "Свой вариант", "данные на"]) {
    assert.ok(toolbar.includes(marker), `в тулбаре нет «${marker}»`);
  }
  const page = await readFile(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");
  assert.match(page, /aggregateRnpWeekly\(base, range\.from\)/);
  assert.match(page, /isBurnedOutSku\(sku\.metrics\)/);
  assert.match(page, /rnpLossReasons\(sku\.metrics\)/);
  // Аномалии откалиброваны по дням — в недельной гранулярности выключаются.
  assert.match(page, /granularity === "week"\) setAnomalyMode\("off"\)/);
});
