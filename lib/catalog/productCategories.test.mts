import assert from "node:assert/strict";
import test from "node:test";

import { resolveProductCategories, type CategoryCardRow, type CategoryCostRow } from "./productCategories.ts";

const card = (article: string | null, nm: number | null, subject: string | null): CategoryCardRow =>
  ({ article, nm_id: nm, subject });
const cost = (article: string | null, category: string | null): CategoryCostRow => ({ article, category });

test("предмет WB становится категорией и ключуется артикулом и номенклатурой", () => {
  const { categories, byArticle } = resolveProductCategories([card("NV-01", 111, "Ветровки")], []);
  assert.deepEqual(categories, ["Ветровки"]);
  assert.equal(byArticle["NV-01"], "Ветровки");
  // Девять роутов отдают артикул как `article || String(nm_id)` — без этого
  // ключа товар с пустым vendorCode не находился бы в карте никогда.
  assert.equal(byArticle["111"], "Ветровки");
});

test("рука бьёт предмет, и бьёт по обоим ключам товара", () => {
  const { byArticle } = resolveProductCategories(
    [card("NV-01", 111, "Ветровки")],
    [cost("NV-01", "Демисезон")],
  );
  assert.equal(byArticle["NV-01"], "Демисезон");
  // Иначе один товар попадал бы в разные кнопки на разных экранах — смотря
  // чем конкретная таблица ключует строку.
  assert.equal(byArticle["111"], "Демисезон");
});

test("артикул с разными предметами не получает артикульного ключа, но получает nm-ключи", () => {
  const { byArticle, categories } = resolveProductCategories(
    [card("DUP", 1, "Куртки"), card("DUP", 2, "Пальто")],
    [],
  );
  assert.equal(byArticle["DUP"], undefined, "гадать между двумя предметами нельзя");
  assert.equal(byArticle["1"], "Куртки");
  assert.equal(byArticle["2"], "Пальто");
  assert.deepEqual(categories, [], "спорный артикул не создаёт кнопку сам по себе");
});

test("ручная категория проставляется и при расхождении предметов: её писал человек", () => {
  const { byArticle } = resolveProductCategories(
    [card("DUP", 1, "Куртки"), card("DUP", 2, "Пальто")],
    [cost("DUP", "Верхняя одежда")],
  );
  assert.equal(byArticle["DUP"], "Верхняя одежда");
  assert.equal(byArticle["1"], "Верхняя одежда");
  assert.equal(byArticle["2"], "Верхняя одежда");
});

test("категории идут по убыванию числа товаров, полезные — первыми", () => {
  const { categories } = resolveProductCategories(
    [
      card("A1", 1, "Куртки"),
      card("A2", 2, "Куртки"),
      card("A3", 3, "Куртки"),
      card("B1", 4, "Сумки"),
      card("B2", 5, "Сумки"),
      card("C1", 6, "Гели"),
    ],
    [],
  );
  assert.deepEqual(categories, ["Куртки", "Сумки", "Гели"]);
});

test("одинаковый вес разводится по алфавиту — порядок кнопок не пляшет между запросами", () => {
  const { categories } = resolveProductCategories(
    [card("A1", 1, "Сумки"), card("B1", 2, "Брюки")],
    [],
  );
  assert.deepEqual(categories, ["Брюки", "Сумки"]);
});

test("вес считается по товарам, а не по ключам: два ключа одного товара — один голос", () => {
  const { categories } = resolveProductCategories(
    [card("A1", 1, "Куртки"), card("B1", 2, "Сумки"), card("B2", 3, "Сумки")],
    [],
  );
  assert.deepEqual(categories, ["Сумки", "Куртки"]);
});

test("пустой предмет и пустая категория не создают кнопок", () => {
  const { categories, byArticle } = resolveProductCategories(
    [card("A1", 1, ""), card("A2", 2, null), card("A3", 3, "   ")],
    [cost("A1", ""), cost("A2", null), cost("A3", "  ")],
  );
  assert.deepEqual(categories, []);
  assert.deepEqual(byArticle, {}, "категории нет — строка честно уходит в «Остальное»");
});

test("пробелы по краям срезаются, иначе «Куртки» и «Куртки » стали бы разными кнопками", () => {
  const { categories, byArticle } = resolveProductCategories(
    [card("  A1  ", 1, "  Куртки  ")],
    [],
  );
  assert.deepEqual(categories, ["Куртки"]);
  assert.equal(byArticle["A1"], "Куртки");
});

test("товар без артикула ключуется одной номенклатурой и считается товаром", () => {
  const { categories, byArticle } = resolveProductCategories(
    [card("", 777, "Пеналы"), card(null, 778, "Пеналы")],
    [],
  );
  assert.equal(byArticle["777"], "Пеналы");
  assert.equal(byArticle["778"], "Пеналы");
  assert.deepEqual(categories, ["Пеналы"]);
});

test("ручная категория у артикула без карточки WB всё равно работает", () => {
  // 70 артикулов себестоимости не имеют карточки WB. Предмета у них нет —
  // но если человек вписал категорию, она обязана дойти до фильтра.
  const { categories, byArticle } = resolveProductCategories([], [cost("BER0101", "Косметика")]);
  assert.deepEqual(categories, ["Косметика"]);
  assert.equal(byArticle["BER0101"], "Косметика");
});
