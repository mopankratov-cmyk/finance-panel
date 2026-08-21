import assert from "node:assert/strict";
import test from "node:test";
import { cellAmount, cellDate, cellState, mapColumns, parsePayoutTable } from "../lib/opiu/browser-collector/parsePayoutTable.mjs";

// Заголовки и строки сняты с живого кабинета WB 21.08.2026 (ООО «ОПТИМА»,
// Финансы → Отчёты реализации → Еженедельные). Суммы изменены, структура — нет.
const WB_HEADERS = [
  "№ отчёта", "Юридическое лицо", "Период", "Дата формирования", "Тип отчёта",
  "Продажа", "В том числе Компенсация скидки по программе лояльности", "К перечислению за товар",
  "Согласованная скидка, %", "Стоимость логистики", "Стоимость хранения",
  "Стоимость операций при приёмке", "Прочие удержания/выплаты", "Общая сумма штрафов",
  "Корректировка Вознаграждения Вайлдберриз (ВВ)", "Стоимость участия в программе лояльности",
  "Сумма баллов, удержанных по программе лояльности",
  "Разовое изменение срока перечисления денежных средств", "Итого к оплате", "Валюта",
];
const WB_ROW = [
  "813379425", 'ООО "ОПТИМА"', "с 10.08.2026 по 16.08.2026", "17.08.2026", "Основной",
  "131 564 061.08", "258 564.54", "102 422 034.72",
  "0", "712 082.37", "0", "360", "13 825 166.04", "442 989.73",
  "0", "5 289.71", "125 728", "0", "87 310 418.87", "руб.",
];
const TARGET = { marketplace: "wb", cabinetId: "cab-1", companyId: "co-1", accountId: "acc-1" };

test("в календарь идёт «Итого к оплате», а не «К перечислению за товар»", () => {
  // Разница между этими колонками на живом отчёте — 15 млн: логистика,
  // хранение, штрафы и программа лояльности удерживаются ПОСЛЕ «к перечислению».
  // Разбор по тексту строки брал бы «к перечислению» — он и ошибался бы на 15 млн.
  const { columns, rows } = parsePayoutTable(WB_HEADERS, [WB_ROW], TARGET, { defaultState: "awaiting_transfer" });
  assert.equal(WB_HEADERS[columns.amount], "Итого к оплате");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 87310418.87);
  assert.notEqual(rows[0].amount, 102422034.72);
});

test("дата формирования отчёта не выдаётся за день выплаты", () => {
  // В отчётах реализации дня выплаты нет вообще — есть период и день, когда
  // отчёт сформирован. Подставить его в календарь значило бы соврать датой.
  const { columns, rows } = parsePayoutTable(WB_HEADERS, [WB_ROW], TARGET, { defaultState: "awaiting_transfer" });
  assert.equal(columns.dateIsWeak, true);
  assert.equal(rows[0].plannedDate, null);
  assert.equal(rows[0].periodFrom, "2026-08-10");
  assert.equal(rows[0].periodTo, "2026-08-16");
  assert.equal(rows[0].reportId, "813379425");
});

test("суммы WB читаются без знака рубля, с точкой и пробелами разрядов", () => {
  assert.equal(cellAmount("7 051 195.73"), 7051195.73);
  assert.equal(cellAmount("87 310 418,87"), 87310418.87);
  assert.equal(cellAmount("-12 500,00 ₽"), -12500);
  assert.equal(cellAmount("125 728"), 125728);
  assert.equal(cellAmount("руб."), null);
  assert.equal(cellAmount(""), null);
});

test("строки истории платежей WB: статус и день платежа читаются", () => {
  // Второй раздел WB — «История платежей»: там есть и дата, и статус.
  const headers = ["ID заявки на оплату", "Сумма", "Валюта", "Дата создания", "Статус оплаты", "Комментарий банка"];
  const sent = ["250086551/386", "2 592.47", "руб.", "24.07.2026", "Оплата успешно проведена банком 24.07.2026", ""];
  const pending = ["250086551/388", "45 133 290.83", "руб.", "17.08.2026", "Оплата обрабатывается", ""];
  const manual = ["250086551/387", "10 254 186.56", "руб.", "10.08.2026", "Платёж передан в ручную обработку", ""];
  const { columns, rows } = parsePayoutTable(headers, [sent, pending, manual], TARGET);
  assert.equal(headers[columns.amount], "Сумма");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].state, "marketplace_sent");
  assert.equal(rows[1].state, "awaiting_transfer");
  assert.equal(rows[2].state, "awaiting_transfer");
  assert.equal(rows[0].amount, 2592.47);
  assert.equal(rows[0].externalId, "wb:cab-1:250086551/386");
});

test("формулировки статусов WB не путают ожидание с отправкой", () => {
  assert.equal(cellState("Оплата успешно проведена банком"), "marketplace_sent");
  assert.equal(cellState("Оплата обрабатывается"), "awaiting_transfer");
  assert.equal(cellState("Платёж передан в ручную обработку"), "awaiting_transfer");
  assert.equal(cellState("К перечислению"), "awaiting_transfer");
  assert.equal(cellState("Товары на складе"), null);
});

test("нулевые и нечитаемые строки пропускаются с причиной", () => {
  const zero = [...WB_ROW];
  zero[18] = "0";
  const broken = [...WB_ROW];
  broken[18] = "—";
  const { rows, skipped } = parsePayoutTable(WB_HEADERS, [zero, broken], TARGET, { defaultState: "awaiting_transfer" });
  assert.equal(rows.length, 0);
  assert.equal(skipped["нулевая сумма выплаты"], 1);
  assert.equal(skipped["сумма в колонке выплаты не читается как число"], 1);
});

test("таблица без колонки суммы не даёт снимков", () => {
  const { rows, skipped } = parsePayoutTable(["Товар", "Остаток"], [["Куртка", "5"]], TARGET);
  assert.equal(rows.length, 0);
  assert.equal(skipped["в таблице нет колонки с суммой выплаты"], 1);
  assert.equal(cellDate("17.08.2026"), "2026-08-17");
  assert.equal(mapColumns(["Товар"]).amount, -1);
});
