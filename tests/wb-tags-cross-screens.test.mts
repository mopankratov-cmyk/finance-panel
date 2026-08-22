import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("../components/wb/useRnpTags.tsx", import.meta.url), "utf8");
const funnel = readFileSync(new URL("../components/wb/WbFunnelPage.tsx", import.meta.url), "utf8");
const shelf = readFileSync(new URL("../components/wb/WbShelfPage.tsx", import.meta.url), "utf8");
const journal = readFileSync(new URL("../components/wb/WbRkJournalPage.tsx", import.meta.url), "utf8");

test("ярлыки РНП работают в Воронке и Полках", () => {
  // Запрос владельца: ярлык на модели → все цвета модели одним фильтром.
  assert.match(funnel, /useRnpTags\(cabinetId\)/);
  assert.match(funnel, /nmMatchesTags\(tagIdsByNm, sku\.nm, activeTagIds\)/);
  assert.match(shelf, /useRnpTags\(hasExactCabinet \? cabinetId : null\)/);
  assert.match(shelf, /nmMatchesTags\(tagIdsByNm, item\.watch\.nmId, activeTagIds\)/);
  // Смена кабинета сбрасывает фильтр: id ярлыков другого кабинета — другие.
  assert.match(funnel, /useEffect\(\(\) => setActiveTagIds\(\[\]\), \[cabinetId\]\)/);
  assert.match(shelf, /useEffect\(\(\) => setActiveTagIds\(\[\]\), \[cabinetId\]\)/);
});

test("сводка по ярлыку в Воронке считается из числителей, а не средних процентов", () => {
  // Среднее процентов по SKU врёт при разных объёмах: CTR группы — это
  // клики/показы всей группы. ДРР восстанавливается из drr×заказы на SKU.
  assert.match(funnel, /shows > 0 \? \(clicks \/ shows\) \* 100 : null/);
  assert.match(funnel, /openCard > 0 \? \(carts \/ openCard\) \* 100 : null/);
  assert.match(funnel, /ordersSum > 0 \? \(advert \/ ordersSum\) \* 100 : null/);
  assert.match(funnel, /Итого по ярлыку/);
  // Проценты по дням из суммы ячеек не собрать — там честный прочерк.
  assert.match(funnel, /currentMetric\.kind === "pct"/);
});

test("журнал РК фильтруется ярлыками и выбирает период календарём", () => {
  assert.match(journal, /nmMatchesTags\(tagIdsByNm, item\.nm, activeTagIds\)/);
  assert.match(journal, /<PeriodRangePicker/);
  // Период уходит в API датами, а не «сколько дней назад».
  assert.match(journal, /params = new URLSearchParams\(\{ from: range\.from, to: range\.to \}\)/);
});

test("сводка Полок честна к выбранному ярлыку", () => {
  assert.match(shelf, /const withTop6 = taggedItems/);
  assert.match(shelf, /activeTagIds\.length \? "По ярлыку" : "В реестре"/);
});

test("недоступность ярлыков не роняет экран", () => {
  // Ярлыки — вспомогательный слой: их отсутствие или ошибка API не должны
  // ломать сам экран, ради которого пользователь пришёл.
  assert.match(hook, /catch\(\(\) => \{\}\)/);
  assert.match(hook, /cabinetId === "all"\) return/);
});

test("ярлык вешается там, где он понадобился, а список перечитывается с сервера", () => {
  // Запрос владельца по журналу РК: ставить ярлык прямо в таблице, не уходя
  // в РНП. Создание и переименование остались в РНП — здесь только
  // назначение конкретному артикулу.
  assert.match(hook, /action: "set_tag"/);
  assert.match(hook, /export function WbTagPicker/);
  // Оптимистичной подмены нет: после записи хук перечитывает назначения,
  // иначе экран показывал бы то, что предположил, а не то, что записалось.
  assert.match(hook, /reloadTags: \(\) => setReloadToken/);
  assert.match(journal, /reloadTags\(\)/);
});

test("в журнале РК панель ярлыков видна до первого назначения", () => {
  // Ярлык вешают прямо в строке артикула, поэтому панель, которая появляется
  // только после первого назначения, читается как отсутствующая функция:
  // в кабинете был заведён ярлык, а фильтра на экране не было вовсе.
  assert.match(hook, /showEmpty\?: boolean/);
  assert.match(journal, /showEmpty/);
  // Ярлыков нет совсем — говорим, где их завести, вместо пустого места.
  assert.match(journal, /Ярлыков в кабинете нет/);
});

test("меню ярлыков не проваливает клики в таблицу", () => {
  // Ячейки журнала липкие и создают свой слой: меню, отрисованное внутри них,
  // клики не перехватывало — вместо выбора ярлыка раскрывался соседний
  // артикул, а назначение не уходило на сервер вовсе.
  assert.match(hook, /createPortal\(/);
  assert.match(hook, /document\.body/);
  // Позиция считается от кнопки, поэтому меню не «уезжает» при прокрутке —
  // на прокрутку оно просто закрывается.
  assert.match(hook, /getBoundingClientRect\(\)/);
  assert.match(hook, /addEventListener\("scroll", close, true\)/);
});
