import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePayoutRow,
  payoutAmount,
  payoutDate,
  payoutState,
  reportIdOf,
} from "../lib/opiu/browser-collector/parsePayoutRow.mjs";

// Снимки выплат уходят в календарь как деньги. Прежний парсер брал ПЕРВУЮ сумму
// и ПЕРВУЮ дату строки: в строке WB это реализация и начало периода отчёта, а не
// выплата и день перечисления. Правило теперь: якорь колонки или молчание.

const target = { marketplace: "wb", cabinetId: "cab-1", companyId: "co-1", accountId: "acc-1" };

test("берётся сумма к перечислению, а не первая сумма строки", () => {
  const row = "Реализация 1 234 567,89 ₽ Комиссия 98 765,43 ₽ К перечислению 1 135 802,46 ₽";
  assert.equal(payoutAmount(row), 1135802.46);
  // Одна сумма без якоря однозначна — её берём.
  assert.equal(payoutAmount("Итого 845 231,55 ₽"), 845231.55);
  // Несколько сумм и ни одного якоря — молчим, а не гадаем.
  assert.equal(payoutAmount("1 000,00 ₽ 2 000,00 ₽"), null);
});

test("суммы не теряют старший разряд и знак", () => {
  assert.equal(payoutAmount("К перечислению 1 234 567,89 ₽"), 1234567.89);
  // Возвраты и удержания приходят отрицательными: «−3 400,10» это не «400,10».
  assert.equal(payoutAmount("К перечислению −3 400,10 ₽"), -3400.1);
  assert.equal(payoutAmount("К выплате -12 500,00 ₽"), -12500);
});

test("дата выплаты — по якорю, а не первая дата строки", () => {
  const row = "Отчёт 01.08.2026 — 07.08.2026, дата выплаты 25.08.2026";
  assert.equal(payoutDate(row, { from: "2026-08-01", to: "2026-08-07" }), "2026-08-25");
  // Без якоря одна дата вне периода — однозначна.
  assert.equal(payoutDate("01.08.2026 — 07.08.2026 · 25.08.2026", { from: "2026-08-01", to: "2026-08-07" }), "2026-08-25");
  // Только границы периода — дня выплаты в строке нет, выдумывать нельзя.
  assert.equal(payoutDate("период 01.08.2026 — 07.08.2026", { from: "2026-08-01", to: "2026-08-07" }), null);
});

test("«К перечислению» — подпись колонки, а не признак отправки денег", () => {
  // Иначе календарь заявит, что деньги уже ушли, хотя они только запланированы.
  assert.equal(payoutState("К перечислению 845 231,55 ₽"), "awaiting_transfer");
  assert.equal(payoutState("Перечислено 845 231,55 ₽"), "marketplace_sent");
  assert.equal(payoutState("Перечислены средства"), "marketplace_sent");
  assert.equal(payoutState("Выплачено"), "marketplace_sent");
  // Граница слова \\b в JS не работает после кириллицы — на этом статус «Перечислено»
  // молча не распознавался и выплата считалась ожидаемой.
  assert.equal(payoutState("Ожидается перечисление"), "awaiting_transfer");
  // Строка вообще не про выплату — не наше дело.
  assert.equal(payoutState("Товары на складе"), null);
});

test("идентификатор отчёта не собирается из обычных слов", () => {
  // «Отчёт о реализации» давал reportId «реализации» — одинаковый для всех строк,
  // и снимки схлопывались в одну запись.
  assert.equal(reportIdOf("Отчёт о реализации за период"), null);
  assert.equal(reportIdOf("отчёт №12345"), "12345");
  assert.equal(reportIdOf("номер документа оплаты: WB-2026-08-77"), "WB-2026-08-77");
});

test("ключ снимка включает кабинет — компании не перетирают друг друга", () => {
  const row = "Отчёт №12345 период 01.08.2026 - 07.08.2026 К перечислению 100,00 ₽ дата выплаты 25.08.2026";
  const first = parsePayoutRow(row, target);
  const second = parsePayoutRow(row, { ...target, cabinetId: "cab-2" });
  assert.equal(first?.externalId, "wb:cab-1:12345");
  assert.notEqual(first?.externalId, second?.externalId);
});

test("неоднозначная строка не превращается в снимок", () => {
  // Реальная строка WB без якорей: одна сумма, только границы периода.
  const row = "Отчёт о реализации за период 01.08.2026 — 07.08.2026 845 231,55 ₽ Ожидается перечисление";
  assert.equal(parsePayoutRow(row, target), null);
});

test("полная строка разбирается целиком и правильно", () => {
  const row = "Отчёт №12345 период 01.08.2026 - 07.08.2026 Реализация 1 234 567,89 ₽ К перечислению 1 135 802,46 ₽ дата выплаты 25.08.2026 Ожидается";
  const snapshot = parsePayoutRow(row, target);
  assert.equal(snapshot?.amount, 1135802.46);
  assert.equal(snapshot?.plannedDate, "2026-08-25");
  assert.equal(snapshot?.periodFrom, "2026-08-01");
  assert.equal(snapshot?.periodTo, "2026-08-07");
  assert.equal(snapshot?.state, "awaiting_transfer");
});
