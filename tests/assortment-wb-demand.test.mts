import assert from "node:assert/strict";
import test from "node:test";
import { demandForTerm, demandTerm, growth, matchDemand, ownSubjects, termMatcher } from "../lib/assortment/wbDemand.ts";

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
  const subjects = [
    { subject: "Сумки", current: [{ word: "хобо", wb_count: 2000 }], previous: [{ word: "хобо", wb_count: 1000 }] },
    { subject: "Сумки кросс-боди", current: [{ word: "хобо кросс боди", wb_count: 300 }], previous: [] },
    { subject: "Рюкзаки", current: [{ word: "рюкзак", wb_count: 999 }], previous: [] },
  ];
  const result = demandForTerm("хобо", subjects);
  assert.deepEqual(result.subjects.map((s) => s.subject), ["Сумки", "Сумки кросс-боди"], "сильнейший сверху");
  assert.equal(result.total, 2300);
  assert.equal(result.growthPct, 100);
  assert.equal(demandForTerm("хобо", [subjects[2]]).found, false);
  assert.equal(growth(10, 0), null);
});

test("Один запрос в нескольких предметах считается один раз, а не суммой", () => {
  const subjects = [
    { subject: "Куртки", current: [{ word: "бомбер женский", wb_count: 5000 }, { word: "бомбер", wb_count: 3000 }], previous: [{ word: "бомбер женский", wb_count: 4000 }] },
    { subject: "Бомберы", current: [{ word: "Бомбер женский", wb_count: 5000 }], previous: [{ word: "бомбер женский", wb_count: 4000 }] },
  ];
  const result = demandForTerm("бомбер", subjects);
  assert.equal(result.total, 8000, "5000 + 3000: «бомбер женский» не удваивается");
  assert.equal(result.growthPct, 25, "5000 против 4000 — рост по запросу, что был в обоих срезах, без удвоения");
  assert.equal(result.subjects.length, 2, "построчно по предметам запрос показан в каждом, где он есть");
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

test("Термин находит слитное и раздельное написание: «кросс-боди» = «кроссбоди» = «кросс боди», «шопер» = «шоппер»", () => {
  const crossbody = termMatcher("кросс-боди");
  for (const q of ["сумка кросс боди женская", "сумка кроссбоди", "Кросс-боди сумка", "сумка кросс-боди"]) assert.equal(crossbody(q), true, q);
  assert.equal(termMatcher("кроссбоди")("сумка кросс боди женская"), true, "слитный термин находит раздельный запрос");
  assert.equal(crossbody("сумка тоут"), false);
  assert.equal(termMatcher("шопер")("сумка шоппер"), true);
  assert.equal(termMatcher("шоппер")("шопер женский"), true);
  assert.equal(termMatcher("сумка хобо")("хобо сумка женская"), true, "слова в любом порядке");
  assert.equal(termMatcher("бомбер")("пуховик"), false);
  assert.equal(termMatcher("до")("кроссбоди"), false, "короткий слитный термин не ищется по склейке (иначе ловит что угодно)");
});

test("Рост по слову: при малой базе процент не показываем («кейп» 60 → 300 — шум, а не +400%)", () => {
  const small = demandForTerm("кейп", [{ subject: "Куртки", current: [{ word: "кейп женский", wb_count: 300 }], previous: [{ word: "кейп женский", wb_count: 60 }] }]);
  assert.equal(small.found, true);
  assert.equal(small.growthPct, null);
  const enough = demandForTerm("кейп", [{ subject: "Куртки", current: [{ word: "кейп женский", wb_count: 3000 }], previous: [{ word: "кейп женский", wb_count: 2000 }] }]);
  assert.equal(enough.growthPct, 50);
});

test("«Новый в топе» — только у предмета, у которого есть прошлый срез", () => {
  const withPrev = matchDemand("Куртки", "бомбер", [{ word: "бомбер женский", wb_count: 100 }], [{ word: "парка", wb_count: 5 }]);
  const noPrev = matchDemand("Бомберы", "бомбер", [{ word: "бомбер женский", wb_count: 100 }], []);
  assert.equal(withPrev.compared, true);
  assert.equal(noPrev.compared, false, "предмет без прошлого среза: сравнивать не с чем");
  assert.equal(noPrev.queries[0].before, null);
});

test("Спрос по модели: мужские и детские запросы не считаются — как на «Формах» (каталоги и профили женские)", () => {
  const current = [
    { word: "бомбер женский", wb_count: 3000 },
    { word: "бомбер мужской", wb_count: 9000 },
    { word: "бомбер детский", wb_count: 4000 },
    { word: "бомбер для мальчика", wb_count: 2000 },
    { word: "бомбер", wb_count: 1000 },
  ];
  const previous = [{ word: "бомбер женский", wb_count: 2000 }, { word: "бомбер мужской", wb_count: 8000 }];
  const s = matchDemand("Куртки", "бомбер", current, previous);
  assert.deepEqual(s.queries.map((q) => q.word), ["бомбер женский", "бомбер"]);
  assert.equal(s.total, 4000);
  assert.equal(s.totalBefore, 2000, "мужской запрос не попадает и в прошлый срез");
  const whole = demandForTerm("бомбер", [{ subject: "Куртки", current, previous }]);
  assert.equal(whole.total, 4000);
  assert.equal(whole.subjects[0].queries.some((q) => /муж|дет|мальч/.test(q.word)), false);
});
