import assert from "node:assert/strict";
import test from "node:test";

import { categoriesOnScreen, filterByCategory } from "../../components/ui/CategoryFilter.tsx";
import { resolveProductCategories } from "./productCategories.ts";

interface Row { art: string }
const rows = (...arts: string[]): Row[] => arts.map((art) => ({ art }));
const artOf = (row: Row) => row.art;

test("на экране остаются только те кнопки, которые что-то отфильтруют", () => {
  const byArticle = { "NV-01": "Ветровки", "HT-42": "Куртки" };
  const all = ["Куртки", "Ветровки", "Пудры", "Игрушечное оружие"];
  const { categories } = categoriesOnScreen(rows("NV-01", "HT-42"), artOf, byArticle, all);
  // «Пудры» на экране с одеждой — кнопка, которая всегда отфильтровывает в ноль.
  assert.deepEqual(categories, ["Куртки", "Ветровки"]);
});

test("частотный порядок с сервера сохраняется, экран его не пересортировывает", () => {
  const byArticle = { A: "Сумки", B: "Куртки" };
  const { categories } = categoriesOnScreen(rows("A", "B"), artOf, byArticle, ["Куртки", "Сумки"]);
  assert.deepEqual(categories, ["Куртки", "Сумки"]);
});

test("«Остальное» появляется только когда есть строки без категории", () => {
  const byArticle = { A: "Сумки" };
  assert.equal(categoriesOnScreen(rows("A"), artOf, byArticle, ["Сумки"]).hasUncategorized, false);
  assert.equal(categoriesOnScreen(rows("A", "Z"), artOf, byArticle, ["Сумки"]).hasUncategorized, true);
});

test("пустой экран не рисует ни одной кнопки", () => {
  const { categories, hasUncategorized } = categoriesOnScreen([], artOf, { A: "Сумки" }, ["Сумки"]);
  assert.deepEqual(categories, []);
  assert.equal(hasUncategorized, false);
});

test("отбор кнопок и фильтрация строк согласованы: выбранная кнопка всегда что-то даёт", () => {
  const byArticle = { A: "Куртки", B: "Ветровки", C: "Куртки" };
  const screen = rows("A", "B", "C", "Z");
  const { categories, hasUncategorized } = categoriesOnScreen(screen, artOf, byArticle, ["Куртки", "Ветровки"]);
  for (const category of categories) {
    assert.ok(filterByCategory(screen, artOf, byArticle, category).length > 0, `кнопка ${category} пуста`);
  }
  assert.equal(hasUncategorized, true);
  assert.deepEqual(filterByCategory(screen, artOf, byArticle, "__none"), [{ art: "Z" }]);
});

test("сквозной путь: карточка WB → карта → кнопки экрана", () => {
  const map = resolveProductCategories(
    [
      { article: "NV-01", nm_id: 111, subject: "Ветровки" },
      { article: "", nm_id: 222, subject: "Куртки" },
    ],
    [],
  );
  // Второй товар без артикула: экран покажет его как String(nm_id) — ключ,
  // которого в карте раньше не было вовсе.
  const screen = rows("NV-01", "222");
  const { categories } = categoriesOnScreen(screen, artOf, map.byArticle, map.categories);
  assert.deepEqual(categories.sort(), ["Ветровки", "Куртки"]);
  assert.deepEqual(filterByCategory(screen, artOf, map.byArticle, "Куртки"), [{ art: "222" }]);
});
