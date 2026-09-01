import assert from "node:assert/strict";
import test from "node:test";
import { parseCalendarGrid } from "./calendarGridImport.ts";

const grid = (title: string) => [
  ["", "", title],
  ["Неделя 1"],
  ["8", "", "", "9"],
  ["", "100000", "", "", "200000"],
];

test("месяц и год находятся не только в первой ячейке", () => {
  const payments = parseCalendarGrid(grid("Платёжный календарь · Сентябрь 2026"), "account");
  assert.equal(payments.length, 2);
  assert.deepEqual(payments.map((payment) => payment.date), ["2026-09-08", "2026-09-09"]);
});

test("ошибка подсказывает требуемый формат заголовка", () => {
  assert.throws(() => parseCalendarGrid(grid("Платёжный календарь"), "account"), /Сентябрь 2026/);
});

test("при пустом заголовке используется открытый месяц календаря", () => {
  const payments = parseCalendarGrid(grid("Платёжный календарь"), "account", { year: 2026, month: 9 });
  assert.deepEqual(payments.map((payment) => payment.date), ["2026-09-08", "2026-09-09"]);
});

test("график кредита не маскируется под календарь", () => {
  assert.throws(() => parseCalendarGrid([
    ["Кредит Сбербанк ООО РИО"],
    ["№", "Тип плановой операции", "Дата платежа", "Плановая сумма"],
    ["1", "Погашение процентов", "46252", "4340.58"],
  ], "account", { year: 2026, month: 9 }), /Кредиты и займы/);
});
