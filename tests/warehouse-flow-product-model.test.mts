import { strict as assert } from "node:assert";
import test from "node:test";
import {
  modelLabelForGroup,
  productColorLabel,
  productModelKey,
  productModelLabel,
  splitArticle,
} from "../lib/warehouse/productModel.ts";

test("артикул режется по последнему разделителю: модель слева, цвет справа", () => {
  // У NV-836-02 два дефиса: модель — всё до последнего, иначе «NV» станет
  // моделью для всей линейки.
  assert.deepEqual(splitArticle("NV-836-02"), { model: "NV-836", color: "02" });
  assert.deepEqual(splitArticle("HT-83-17"), { model: "HT-83", color: "17" });
  assert.deepEqual(splitArticle("673/бежевый"), { model: "673", color: "бежевый" });
  assert.deepEqual(splitArticle("216(150) коричневый"), { model: "216(150)", color: "коричневый" });
});

test("артикул без разделителя — целиком модель, цвета нет", () => {
  assert.deepEqual(splitArticle("ANJ036501"), { model: "ANJ036501", color: null });
});

test("пустой артикул не ломает разбор", () => {
  assert.deepEqual(splitArticle(""), { model: "", color: null });
  assert.deepEqual(splitArticle("   "), { model: "", color: null });
});

test("длинный хвост — не код цвета, а часть названия", () => {
  const tail = "x".repeat(25);
  assert.deepEqual(splitArticle(`NV-836-${tail}`), { model: `NV-836-${tail}`, color: null });
  // Ровно 24 символа ещё считаются цветом.
  const ok = "y".repeat(24);
  assert.deepEqual(splitArticle(`NV-836-${ok}`), { model: "NV-836", color: ok });
});

test("однобуквенная модель — совпадение, а не модель", () => {
  assert.deepEqual(splitArticle("A-01"), { model: "A-01", color: null });
});

test("пробелы по краям артикула не влияют на разбор", () => {
  assert.deepEqual(splitArticle("  NV-836-02  "), { model: "NV-836", color: "02" });
});

test("группа карточек с общим imtID подписывается общим префиксом артикулов", () => {
  assert.equal(modelLabelForGroup(["NV-836-02", "NV-836-04", "NV-836-35"]), "NV-836");
  // Регистр букв не разводит одну модель на две.
  assert.equal(modelLabelForGroup(["nv-836-02", "NV-836-35"]), "nv-836");
});

test("общий префикс обрезается по разделителю, а не по общей цифре кодов цвета", () => {
  // У кодов 02 и 04 общая цифра «0»: посимвольный префикс даёт «NV-836-0» —
  // такой подписи модели не бывает. Граница модели — последний разделитель.
  assert.equal(modelLabelForGroup(["NV-836-02", "NV-836-04"]), "NV-836");
  assert.equal(modelLabelForGroup(["HT-42-10", "HT-42-17"]), "HT-42");
});

test("одна карточка в группе — подпись из разбора артикула", () => {
  assert.equal(modelLabelForGroup(["NV-836-02"]), "NV-836");
  assert.equal(modelLabelForGroup(["ANJ036501"]), "ANJ036501");
});

test("группа без общего префикса подписывается разбором первой карточки", () => {
  assert.equal(modelLabelForGroup(["NV-836-02", "HT-83-17"]), "NV-836");
  // Совпадение одной буквы — не модель.
  assert.equal(modelLabelForGroup(["NV-836-02", "NX-100-01"]), "NV-836");
});

test("пустая группа и пустые артикулы дают пустую подпись", () => {
  assert.equal(modelLabelForGroup([]), "");
  assert.equal(modelLabelForGroup(["", "  "]), "");
});

test("ключ модели: карточка WB важнее подписи, подпись важнее артикула", () => {
  assert.equal(productModelKey({ imtId: 123, model: "NV-836", article: "NV-836-02" }), "imt:123");
  assert.equal(productModelKey({ imtId: null, model: "NV-836", article: "NV-836-02" }), "model:nv-836");
  assert.equal(productModelKey({ imtId: null, model: null, article: "NV-836-02" }), "article:nv-836");
  assert.equal(productModelKey({ article: "NV-836-02" }), "article:nv-836");
});

test("ключ модели не различает регистр подписи, а нулевой imtID не считается карточкой", () => {
  assert.equal(productModelKey({ model: "nv-836", article: "X" }), productModelKey({ model: "NV-836", article: "Y" }));
  assert.equal(productModelKey({ imtId: 0, model: "NV-836", article: "NV-836-02" }), "model:nv-836");
  assert.equal(productModelKey({ imtId: -5, model: "", article: "NV-836-02" }), "article:nv-836");
});

test("две карточки с одинаковой подписью, но разными imtID — разные модели", () => {
  assert.notEqual(
    productModelKey({ imtId: 1, model: "NV-836", article: "NV-836-02" }),
    productModelKey({ imtId: 2, model: "NV-836", article: "NV-836-04" }),
  );
});

test("подпись модели: записанная, иначе из артикула", () => {
  assert.equal(productModelLabel({ model: "Ветровка", article: "NV-836-02" }), "Ветровка");
  assert.equal(productModelLabel({ model: "  ", article: "NV-836-02" }), "NV-836");
  assert.equal(productModelLabel({ article: "ANJ036501" }), "ANJ036501");
});

test("подпись цвета: записанный, иначе хвост артикула, иначе пусто", () => {
  assert.equal(productColorLabel({ color: "бежевый", article: "NV-836-02" }), "бежевый");
  assert.equal(productColorLabel({ color: null, article: "NV-836-02" }), "02");
  assert.equal(productColorLabel({ color: "", article: "ANJ036501" }), "");
});
