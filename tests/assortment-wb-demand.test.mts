import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DemandBody, type Demand } from "../components/assortment/WbDemand.tsx";
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

// --- рост и исключения на странице модели — те же правила, что на «Формах» (05.10) ---

const W = Array.from({ length: 40 }, (_, i) => ({ word: `бомбер вариант ${i}`, wb_count: 1000 }));
const demandOf = (term: string, current: typeof W, previous: typeof W) => demandForTerm(term, [{ subject: "Куртки", current, previous }]);
const asDemand = (r: ReturnType<typeof demandForTerm>): Demand => ({ ...r, period: { from: "2026-09-06", to: "2026-10-05" }, subjectsChecked: ["Куртки"], previousTo: "2026-09-05", queriesChecked: 40 });
const flat = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("Рост по слову модели: срезы совпали — роста нет (не «+0%»), прошлого нет — none, разные срезы — считается", () => {
  const same = demandOf("бомбер", W, W);
  assert.equal(same.growthBase, "identical");
  assert.equal(same.growthPct, null, "совпавшие срезы не дают «+0%» как факт");
  const grown = demandOf("бомбер", W, W.map((q) => ({ ...q, wb_count: 500 })));
  assert.equal(grown.growthBase, "ok");
  assert.equal(grown.growthPct, 100);
  const none = demandOf("бомбер", W, []);
  assert.equal(none.growthBase, "none");
  assert.equal(none.growthPct, null);
});

test("Проверка «срезы совпали» не засчитывает мужские запросы: их неизменная частотность не должна убить рост по женским", () => {
  const men = Array.from({ length: 400 }, (_, i) => ({ word: `куртка мужская модель ${i}`, wb_count: 2000 }));
  const current = [...W, ...men];
  const previous = [...W.map((q) => ({ ...q, wb_count: 500 })), ...men];
  const r = demandForTerm("бомбер", [{ subject: "Куртки", current, previous }]);
  assert.equal(r.growthBase, "ok", "среди женских срезы разные, неизменные мужские в проверку не входят");
  assert.equal(r.growthPct, 100);
});

test("Исключения на странице модели: убранные запросы посчитаны и названы; слово модели само «школьный рюкзак» — не исключается", () => {
  const current = [{ word: "рюкзак женский", wb_count: 20000 }, { word: "рюкзак школьный", wb_count: 90000 }, { word: "рюкзак мужской", wb_count: 40000 }];
  const r = demandForTerm("рюкзак", [{ subject: "Рюкзаки", current, previous: [] }]);
  assert.equal(r.total, 20000);
  assert.deepEqual(r.excluded, { queries: 2, searches: 130000 }, "что убрали — видно, а не молча");
  const asked = demandForTerm("школьный рюкзак", [{ subject: "Рюкзаки", current, previous: [] }]);
  assert.equal(asked.found, true, "владелец спросил именно про школьные — исключения не применяются");
  assert.equal(asked.total, 90000);
  assert.deepEqual(asked.excluded, { queries: 0, searches: 0 });
  const onlyBad = demandForTerm("рюкзак", [{ subject: "Рюкзаки", current: [{ word: "рюкзак школьный", wb_count: 9000 }], previous: [] }]);
  assert.equal(onlyBad.found, false);
  assert.equal(onlyBad.excluded.searches, 9000);
});

test("Экран спроса по модели: рост нейтральный и «возможно сезон»; причина, когда роста нет; подпись про убранные запросы; «запросов нет» не врёт, когда всё убрал фильтр", () => {
  const grown = asDemand(demandOf("бомбер", W, W.map((q) => ({ ...q, wb_count: 500 }))));
  const html = renderToStaticMarkup(createElement(DemandBody, { term: "бомбер", demand: grown }));
  assert.doesNotMatch(html, /text-green-|text-red-/);
  assert.match(flat(html), /\(\+100% к срезу на 05\.09, возможно сезон\)/);
  const identical = flat(renderToStaticMarkup(createElement(DemandBody, { term: "бомбер", demand: asDemand(demandOf("бомбер", W, W)) })));
  assert.match(identical, /Рост не считаем: у почти всех запросов частотность та же/);
  assert.doesNotMatch(identical, /\+0%/);
  const none = flat(renderToStaticMarkup(createElement(DemandBody, { term: "бомбер", demand: asDemand(demandOf("бомбер", W, [])) })));
  assert.match(none, /Прошлого среза для роста пока нет/);
  const withExcluded = flat(renderToStaticMarkup(createElement(DemandBody, { term: "бомбер", demand: asDemand(demandOf("бомбер", [...W, { word: "бомбер мужской", wb_count: 7000 }], [])) })));
  assert.match(withExcluded, /Мужские, детские и не по теме запросы со словом «бомбер» \(1, частотность 7\s000\) в расчёт не вошли/);
  const allGone = flat(renderToStaticMarkup(createElement(DemandBody, { term: "рюкзак", demand: asDemand(demandForTerm("рюкзак", [{ subject: "Рюкзаки", current: [{ word: "рюкзак школьный", wb_count: 9000 }], previous: [] }])) })));
  assert.match(allGone, /Запросов со словом «рюкзак» для наших каталогов нет: мужские, детские и не по теме запросы/);
  assert.doesNotMatch(allGone, /спрос небольшой/, "спрос не «небольшой» — его убрал фильтр");
  const nothing = flat(renderToStaticMarkup(createElement(DemandBody, { term: "хобо", demand: asDemand(demandForTerm("хобо", [{ subject: "Сумки", current: [], previous: [] }])) })));
  assert.match(nothing, /спрос небольшой или на WB это называют иначе/);
});
