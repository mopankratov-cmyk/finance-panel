import assert from "node:assert/strict";
import test from "node:test";
import { buildCtrProductTotals } from "../lib/ctrtest/productTotals";

/**
 * Кандидатам на экране CTR-тестов нужны артикул и остаток. Раньше их приносил
 * агрегат rnp_report — и на кабинете «Оптима» роут падал по серверному
 * statement timeout, отдавая 500 и пустую таблицу.
 */

test("остаток складывается по складам, артикул берётся из карточки", () => {
  const totals = buildCtrProductTotals(
    [{ nm_id: 1, article: "HT-83-11" }, { nm_id: 2, article: "ESC00121" }],
    [
      { nm_id: 1, quantity: 4 },
      { nm_id: 1, quantity: 7 },
      { nm_id: 2, quantity: 3 },
    ],
  );
  const byNm = new Map(totals.map((row) => [row.nm_id, row]));
  assert.equal(byNm.get(1)?.stock, 11, "одна номенклатура — строка на каждый склад");
  assert.equal(byNm.get(1)?.article, "HT-83-11");
  assert.equal(byNm.get(2)?.stock, 3);
});

test("товар без остатка остаётся в списке с нулём", () => {
  const totals = buildCtrProductTotals([{ nm_id: 5, article: "NV-01-35" }], []);
  assert.deepEqual(totals, [{ nm_id: 5, article: "NV-01-35", stock: 0 }]);
});

test("остаток без карточки не теряется", () => {
  // Карточку могли не синкнуть, а товар лежит на складе и крутится в рекламе.
  // Экран подставит номер вместо артикула — это честнее, чем потерять строку.
  const totals = buildCtrProductTotals([], [{ nm_id: 9, quantity: 2 }]);
  assert.deepEqual(totals, [{ nm_id: 9, article: "", stock: 2 }]);
});

test("дубль карточки с пустым артикулом не стирает непустой", () => {
  const totals = buildCtrProductTotals(
    [{ nm_id: 3, article: "HT-80-02" }, { nm_id: 3, article: null }],
    [{ nm_id: 3, quantity: 1 }],
  );
  assert.deepEqual(totals, [{ nm_id: 3, article: "HT-80-02", stock: 1 }]);
});

test("пустой товарный контур не открывает каталог целиком", async () => {
  // Сторож на границу: у ограниченного пользователя пустой список кабинетов
  // означает «ни одной номенклатуры». Проверяем сам контракт загрузчика.
  const { loadCtrProductTotals } = await import("../lib/ctrtest/productTotals");
  const db = { from() { throw new Error("база не должна опрашиваться"); } };
  const rows = await loadCtrProductTotals(db as never, "cab", new Set<number>());
  assert.deepEqual(rows, []);
});
