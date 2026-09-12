import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  isPlannerSuggestion,
  planDailyRkTask,
  RK_BACK_IN_STOCK_NOTE,
  RK_MAX_CARRY_DAYS,
  RK_OUT_OF_STOCK_NOTE,
} from "../lib/wb/rkDailyTasks.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * Ежедневная простановка задач — так, как это делают руками.
 *
 * Выведено из рабочей таблицы «Показы CTR CPC», 6 213 решений за 120 дней.
 * Решение повторяет вчерашнее в 67,9% пар «вчера → сегодня» по тексту и в 89,0%
 * по смысловой группе, а самая частая смена группы — «бюджет → откл до
 * отгрузки» (80 раз): товар кончился.
 */

const yesterday = (note: string, source: "auto" | "human" = "human", carriedDays = 1) =>
  ({ note, source, carriedDays });

test("нулевой остаток перебивает вчерашнее решение", () => {
  // Рекламировать то, чего нет, нельзя ни при каком бюджете. В корпусе это
  // самый частый переход между группами.
  const task = planDailyRkTask({ yesterday: yesterday("2 000 ₽, запуск 17:00"), stock: 0, advertised: true });
  assert.equal(task?.note, RK_OUT_OF_STOCK_NOTE);
  assert.match(task!.reason, /Остаток нулевой/);
});

test("неизвестный остаток не считается нулём", () => {
  // null — «не знаем», и выключать по незнанию нельзя: так гасят живой товар.
  const task = planDailyRkTask({ yesterday: yesterday("Круглосуточно"), stock: null, advertised: true });
  assert.equal(task?.note, "Круглосуточно");
});

test("вчерашнее решение переносится как есть", () => {
  // Основа правила: 67,9% решений повторяют вчерашнее дословно.
  for (const note of ["Откл остатки", "3 000 ₽, только полки CPM", "Работа с 17:00 - 24:00", "своя формулировка"]) {
    const task = planDailyRkTask({ yesterday: yesterday(note), stock: 120, advertised: true });
    assert.equal(task?.note, note);
    assert.equal(task?.reason, "Перенос вчерашнего решения");
  }
});

test("поставка пришла — гасить дальше нельзя", () => {
  // Вчера выключили до отгрузки, сегодня остаток есть. Что включать — бюджет
  // или расписание — решает человек: в корпусе после отгрузки ставят и то, и
  // другое, и угадывать за него мы не станем.
  const task = planDailyRkTask({ yesterday: yesterday(RK_OUT_OF_STOCK_NOTE), stock: 40, advertised: false });
  assert.equal(task?.note, RK_BACK_IN_STOCK_NOTE);
  assert.match(task!.reason, /Остаток появился \(40 шт\.\)/);
});

test("нет вчерашней задачи — молчим", () => {
  // Журнал в сотни строк, где подписана каждая, читать перестают. Молчание —
  // штатный ответ, а не отказ.
  assert.equal(planDailyRkTask({ yesterday: null, stock: 300, advertised: true }), null);
  assert.equal(planDailyRkTask({ yesterday: yesterday("   "), stock: 300, advertised: true }), null);
  // А вот нулевой остаток говорит сам за себя даже без вчерашней задачи.
  assert.equal(planDailyRkTask({ yesterday: null, stock: 0, advertised: true })?.note, RK_OUT_OF_STOCK_NOTE);
});

test("совет, который никто не открывал, не живёт вечно", () => {
  // Самая длинная серия одинаковых решений в корпусе — 22 дня, 90-й
  // перцентиль — 5. Две недели заметно выше обычного и при этом не дают
  // предложению висеть месяцами.
  const fresh = planDailyRkTask({ yesterday: yesterday("Откл остатки", "auto", RK_MAX_CARRY_DAYS - 1), stock: 10, advertised: true });
  assert.equal(fresh?.note, "Откл остатки");
  assert.match(fresh!.reason, /14-й день без правок/);
  const stale = planDailyRkTask({ yesterday: yesterday("Откл остатки", "auto", RK_MAX_CARRY_DAYS), stock: 10, advertised: true });
  assert.equal(stale, null);
  // Решение ЧЕЛОВЕКА переносится без потолка: это его слово, а не наша догадка.
  const human = planDailyRkTask({ yesterday: yesterday("Откл остатки", "human", 99), stock: 10, advertised: true });
  assert.equal(human?.note, "Откл остатки");
});

test("нулевой остаток сильнее потолка переноса", () => {
  // Иначе товар без остатка остался бы без задачи именно тогда, когда она
  // нужнее всего.
  const task = planDailyRkTask({ yesterday: yesterday("Откл остатки", "auto", 99), stock: 0, advertised: true });
  assert.equal(task?.note, RK_OUT_OF_STOCK_NOTE);
});

test("ночной прогон больше не советует ставку", () => {
  // Сверка 12.09.2026: ставку руками в августе меняли 26 раз из 4 401 решения,
  // а из 491 дня, когда высказались оба, направление совпало ОДИН раз. Правила
  // остались в rkAutoTask.ts и покрыты тестами, но в журнал не пишут.
  const route = read("../app/api/sync/rk-autotask/route.ts");
  assert.match(route, /planDailyRkTask/);
  assert.doesNotMatch(route, /suggestRkTask/);
  assert.doesNotMatch(route, /computeRkTaskBounds/);
});

test("правило остатка — товарное, а перенос идёт в ту же клетку", () => {
  // Остаток общий, и «Откл до отгрузки», продублированная по каждой кампании,
  // превращается в шум: прогон по 01.09 давал четыре одинаковых задачи на один
  // артикул. А вот задачу, написанную человеком про конкретную кампанию,
  // переносить надо туда же, а не на товар целиком.
  const route = read("../app/api/sync/rk-autotask/route.ts");
  assert.match(route, /candidate\.advertId === null && stockByKey\.has/);
  assert.match(route, /for \(const \[key, task\] of yesterdayByCell\)/);
  assert.match(route, /advert_id: candidate\.advertId,/);
});

test("переносится только ВЧЕРАШНЯЯ задача", () => {
  // Разрыв в днях означает, что товар выпал из работы, и тянуть решение
  // недельной давности нельзя.
  const route = read("../app/api/sync/rk-autotask/route.ts");
  assert.match(route, /if \(!last \|\| last\.date !== yesterdayIso\) continue/);
  // Серия прерывается и сменой текста, и правкой человека, и пропущенным днём.
  assert.match(route, /row\.date !== cursor \|\| String\(row\.note\)\.trim\(\) !== note \|\| row\.source === "human"/);
});

test("человека не затирают", () => {
  // Главное правило прогона: совет появляется только там, где пусто.
  const route = read("../app/api/sync/rk-autotask/route.ts");
  assert.match(route, /if \(taken\.has\(key\)\) \{ skippedTaken\+\+; continue; \}/);
  assert.match(route, /source: "auto"/);
});

test("отменённые советы про ставку не переносятся", () => {
  // Сухой прогон 12.09.2026 честно показал «Поднять ставку до 5,23 ₽ · перенос
  // вчерашнего предложения, 2-й день»: без фильтра прогон сам поддерживал бы
  // то, от чего мы уходим.
  assert.equal(isPlannerSuggestion("Перенос вчерашнего решения"), true);
  assert.equal(isPlannerSuggestion("Остаток нулевой — рекламировать нечего"), true);
  assert.equal(isPlannerSuggestion("Остаток появился (19 шт.) — вчера реклама была выключена до отгрузки"), true);
  assert.equal(isPlannerSuggestion("Заказы есть, но реклама съела 10,98% от них при потолке 10,48%"), false);
  assert.equal(isPlannerSuggestion("Полки, заказов нет при расходе 1 200 ₽"), false);
  assert.equal(isPlannerSuggestion(null), false);
  const route = read("../app/api/sync/rk-autotask/route.ts");
  assert.match(route, /row\.source === "auto" && !isPlannerSuggestion\(row\.suggested_reason\)/);
  // Решение человека переносится всегда — это его слово, а не наша догадка.
  assert.doesNotMatch(route, /row\.source === "human" &&[^\n]*continue/);
});

test("перенос не зависит от ночного снимка", () => {
  // Задача говорит, что делать сегодня, а не объясняет прошедший день. Если
  // синк не собрался, цепочка задач рваться не должна: люди свою работу из-за
  // нашего сбоя не прекращают.
  const route = read("../app/api/sync/rk-autotask/route.ts");
  const notes = route.indexOf("Автозадачи: история задач");
  const guard = route.indexOf("Ни снимка, ни задач");
  assert.ok(notes > 0 && guard > notes, "история задач должна читаться до проверки на пустоту");
  assert.match(route, /\.\.\.noteRows\.map\(\(row\) => row\.cabinet_id\)/);
});

test("остаток говорит только за вчера и сегодня", () => {
  // Остатки хранятся одним срезом — на сейчас. За сутки склад меняется мало, а
  // за неделю меняется, и правило написало бы в прошедшие дни неправду: сухой
  // прогон 12.09.2026 давал 42 задачи «Вкл» на 10 сентября только потому, что
  // остаток есть сегодня. При прогоне за прошлое работает один перенос.
  const route = read("../app/api/sync/rk-autotask/route.ts");
  assert.match(route, /const stockKnown = date >= shiftIso\(moscowYesterday\(\), 0\)/);
  assert.match(route, /stockKnown && candidate\.advertId === null/);
});

test("«Вкл» не превращается в ежедневное «включи ещё раз»", () => {
  // Это разовое действие, а не режим работы. Первый прогон по пяти дням дал 96
  // таких задач на 48 товаров: перенос тащил включение изо дня в день.
  assert.equal(planDailyRkTask({ yesterday: yesterday(RK_BACK_IN_STOCK_NOTE, "auto", 1), stock: 200, advertised: true }), null);
  assert.equal(planDailyRkTask({ yesterday: yesterday(RK_BACK_IN_STOCK_NOTE, "human", 1), stock: 200, advertised: true }), null);
  // А нулевой остаток всё равно сильнее: товар кончился — выключаем.
  assert.equal(
    planDailyRkTask({ yesterday: yesterday(RK_BACK_IN_STOCK_NOTE), stock: 0, advertised: true })?.note,
    RK_OUT_OF_STOCK_NOTE,
  );
});
