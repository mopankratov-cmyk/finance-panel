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

// Снято с живого кабинета Ozon 21.08.2026 (CLERIN, Финансы → Выплаты).
// Суммы изменены, структура — нет.
const OZON_HEADERS = [
  "Тип выплаты", "Сумма", "Статус выплаты", "Планируемая дата выплаты",
  "Дата отправки выплаты", "Период", "Номер документа оплаты",
];

test("Ozon: сумма-дубль в ячейке читается, берётся фактический день отправки", () => {
  // Ozon пишет в ячейку две одинаковые суммы («22 948 ₽ 22 948 ₽») — начислено
  // и к выплате. Равны — значит это одно число. И у него есть обе даты:
  // планируемая и фактическая; в календарь идёт фактическая.
  const paid = [
    "Оплата реализации", "117 922 ₽ 117 922 ₽", "Выплачена",
    "08.07.2026", "15.06.2026", "08.06.2026 – 14.06.2026",
    "Оплата факторинга №428854 от 15.06.2026",
  ];
  const { columns, rows } = parsePayoutTable(OZON_HEADERS, [paid], { ...TARGET, marketplace: "ozon" });
  assert.equal(OZON_HEADERS[columns.amount], "Сумма");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 117922);
  assert.equal(rows[0].plannedDate, "2026-06-15");
  assert.equal(rows[0].state, "marketplace_sent");
  assert.equal(rows[0].reportId, "428854");
  assert.equal(rows[0].periodFrom, "2026-06-08");
  assert.equal(rows[0].periodTo, "2026-06-14");
});

test("Ozon: пока выплата не ушла, берётся планируемая дата", () => {
  const planned = [
    "Оплата реализации", "50 000 ₽ 50 000 ₽", "Ожидается",
    "05.09.2026", "", "24.08.2026 – 30.08.2026", "№319999 от 01.09.2026",
  ];
  const { rows } = parsePayoutTable(OZON_HEADERS, [planned], { ...TARGET, marketplace: "ozon" });
  assert.equal(rows[0].plannedDate, "2026-09-05");
  assert.equal(rows[0].state, "awaiting_transfer");
});

test("Ozon: разные суммы в одной ячейке — отказ, а не выбор наугад", () => {
  // Начислено и к выплате разошлись (например, удержание). Какая из них
  // «выплата» — по ячейке не видно, поэтому строка не берётся.
  const ambiguous = [
    "Прочие выплаты", "10 000 ₽ 7 500 ₽", "Выплачена",
    "02.06.2026", "02.06.2026", "—", "№428361 от 02.06.2026",
  ];
  const { rows, skipped } = parsePayoutTable(OZON_HEADERS, [ambiguous], { ...TARGET, marketplace: "ozon" });
  assert.equal(rows.length, 0);
  assert.equal(skipped["сумма в колонке выплаты не читается как число"], 1);
});

test("Ozon: строка без периода опознаётся по номеру документа", () => {
  const noPeriod = [
    "Прочие выплаты", "2 849 ₽ 2 849 ₽", "Выплачена",
    "02.06.2026", "02.06.2026", "—", "Оплата факторинга №428361 от 02.06.2026",
  ];
  const { rows } = parsePayoutTable(OZON_HEADERS, [noPeriod], { ...TARGET, marketplace: "ozon" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].periodFrom, null);
  assert.equal(rows[0].externalId, "ozon:cab-1:428361");
});

test("отрицательное «Итого к оплате» — это долг продавца, а не выплата", () => {
  // Живой прогон 21.08: у COSMOS SHOP пришло -81 455,91, у Оптимы -5 160,78 —
  // удержания за период перекрыли реализацию. В календарь поступлений такому
  // не место; панель такие снимки и так отвергает, но раньше первая же такая
  // строка обрывала весь кабинет, и 14 законных выплат не доходили.
  const debt = [...WB_ROW];
  debt[18] = "-81 455.91";
  const { rows, skipped } = parsePayoutTable(WB_HEADERS, [debt], TARGET, { defaultState: "awaiting_transfer" });
  assert.equal(rows.length, 0);
  assert.equal(skipped["сумма отрицательная — это удержание, а не выплата"], 1);
  // Сам разбор числа знак по-прежнему понимает — отказ принимает parsePayoutTableRow.
  assert.equal(cellAmount("-81 455.91"), -81455.91);
});
