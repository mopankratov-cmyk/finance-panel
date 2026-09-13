import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Баг: need() на /supplies считал потребность к поставке по остатку и «в пути
// от WB клиенту», но не видел уже оформленный, но ещё не принятый заказ
// поставщику (открытая партия purchase_receipts) — байер видел завышенное
// «нужно дозаказать N» и рисковал задвоить заказ. Фикс — вычесть открытые
// партии (received_at IS NULL) по nm_id из need(), не уходя в минус.
test("need() на /supplies вычитает открытые (ещё не принятые) партии закупки", async () => {
  const source = await readFile(new URL("../app/api/supplies/route.ts", import.meta.url), "utf8");

  // Источник открытых партий — тот же критерий, что openNmIds в
  // components/supplies/ReceivingTab.tsx: received_at IS NULL.
  assert.match(source, /from\("purchase_receipts"\)/);
  assert.match(source, /\.is\("received_at",\s*null\)/);

  // Суммируем expected_qty по nm_id — не по батчу и не по кабинету.
  assert.match(source, /openPurchaseQtyByNm/);
  assert.match(source, /expected_qty/);

  // need() принимает и вычитает уже заказанное (onOrder), floor остаётся на нуле.
  assert.match(source, /const need = \(avgDaily: number, stock: number, inWay: number, horizon: number, onOrder: number\) =>/);
  assert.match(source, /Math\.max\(0, Math\.ceil\(avgDaily \* horizon - stock - inWay - onOrder\)\)/);
  assert.match(source, /need30: need\(avgDaily, stock, inWay, 30, onOrder\)/);
  assert.match(source, /need45: need\(avgDaily, stock, inWay, 45, onOrder\)/);
  assert.match(source, /need60: need\(avgDaily, stock, inWay, 60, onOrder\)/);

  // Отсутствующая таблица/колонка (миграция ещё не применена) не должна ронять
  // весь экран «Поставки» — как и у необязательных габаритов WB (pimRowsPromise).
  assert.match(source, /fetchOpenPurchaseReceipts/);
});

// Сама формула floor-at-zero — прямая проверка арифметики без импорта route.ts
// (там need() — замыкание внутри GET, не экспортируется).
test("need() никогда не уходит в минус, даже если открытая партия перекрывает потребность", () => {
  const need = (avgDaily: number, stock: number, inWay: number, horizon: number, onOrder: number) =>
    Math.max(0, Math.ceil(avgDaily * horizon - stock - inWay - onOrder));

  // 10/день × 30 дней = 300, остаток 50, в пути от WB 0, уже заказано (открытая
  // партия) 400 — потребности больше нет, дозаказ не нужен.
  assert.equal(need(10, 50, 0, 30, 400), 0);
  // Открытая партия закрывает не всю потребность — остаток дозаказа положительный.
  assert.equal(need(10, 50, 0, 30, 100), 150);
  // Без открытых партий (onOrder = 0) поведение не меняется — старый расчёт.
  assert.equal(need(10, 50, 0, 30, 0), 250);
});
