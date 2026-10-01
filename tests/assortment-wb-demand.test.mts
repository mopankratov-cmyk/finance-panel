import assert from "node:assert/strict";
import test from "node:test";
import { combineDemand, demandTerm, growth, matchDemand, ownSubjects } from "../lib/assortment/wbDemand.ts";

/** Спрос на WB по слову модели: частотность MPSTATS, без цен и выручки. */

test("Слово для поиска: «Запрос на WB», иначе силуэт сумки или подтип куртки; «не видно» — не слово", () => {
  assert.equal(demandTerm("bags", { wb_query: "Сумка Хобо", silhouette: "багет" }), "сумка хобо");
  assert.equal(demandTerm("bags", { silhouette: "хобо" }), "хобо");
  assert.equal(demandTerm("jackets", { subtype: "Бомбер", silhouette: "x" }), "бомбер");
  assert.equal(demandTerm("bags", { silhouette: "не видно" }), null);
  assert.equal(demandTerm("bags", { silhouette: "ab" }), null);
  assert.equal(demandTerm("jackets", {}), null);
});

test("Совпадение по всем словам, ё = е; рост — только по запросам, что были в обоих периодах", () => {
  const current = [
    { word: "сумка хобо женская", wb_count: 1200, items_count: 3400 },
    { word: "Хобо сумка", wb_count: 800, items_count: 2100 },
    { word: "сумка хобо кожаная", wb_count: 500 },
    { word: "сумка тоут", wb_count: 9000 },
  ];
  const previous = [
    { word: "сумка хобо женская", wb_count: 1000 },
    { word: "хобо сумка", wb_count: 1000 },
  ];
  const s = matchDemand("Сумки", "сумка хобо", current, previous);
  assert.deepEqual(s.queries.map((q) => q.word), ["сумка хобо женская", "Хобо сумка", "сумка хобо кожаная"]);
  assert.equal(s.total, 2500);
  assert.equal(s.queries[2].before, null, "новый запрос в топе");
  assert.equal(s.growthPct, 0, "(1200+800)/(1000+1000): новый запрос рост не раздувает");
  assert.equal(s.queries[0].items, 3400);
  assert.equal(matchDemand("Куртки", "пухов", [{ word: "Пуховик женский", wb_count: 10 }], []).total, 10);
  assert.equal(matchDemand("Куртки", "пуховик", [{ word: "Пуховик женский", wb_count: 10 }], []).growthPct, null);
});

test("Сводка по предметам: пустые отбрасываются, сильнейший сверху, «не найдено» честно", () => {
  const a = matchDemand("Сумки", "хобо", [{ word: "хобо", wb_count: 100 }], [{ word: "хобо", wb_count: 50 }]);
  const b = matchDemand("Сумки кросс-боди", "хобо", [{ word: "хобо кросс боди", wb_count: 300 }], []);
  const c = matchDemand("Рюкзаки", "хобо", [{ word: "рюкзак", wb_count: 999 }], []);
  const result = combineDemand("хобо", [a, b, c]);
  assert.deepEqual(result.subjects.map((s) => s.subject), ["Сумки кросс-боди", "Сумки"]);
  assert.equal(result.total, 400);
  assert.equal(result.growthPct, 100);
  assert.equal(combineDemand("хобо", [c]).found, false);
  assert.equal(growth(10, 0), null);
});

test("Предметы — только своих брендов раздела, самые частые первыми", () => {
  const rows = [
    { subject: "Сумки", nm_id: 1, brand: "CLÉRIN" },
    { subject: "Сумки", nm_id: 2, brand: "Clerin" },
    { subject: "Сумки кросс-боди", nm_id: 3, brand: "CLÉRIN" },
    { subject: "Куртки", nm_id: 4, brand: "NORVIA" },
    { subject: "Пуховики", nm_id: 5, brand: "HEATON" },
    { subject: "Платья", nm_id: 6, brand: "Чужой бренд" },
  ];
  assert.deepEqual(ownSubjects(rows, "bags"), [{ subject: "Сумки", nmId: 1, count: 2 }, { subject: "Сумки кросс-боди", nmId: 3, count: 1 }]);
  assert.deepEqual(ownSubjects(rows, "jackets").map((s) => s.subject), ["Куртки", "Пуховики"]);
});
