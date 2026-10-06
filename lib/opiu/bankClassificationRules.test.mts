import assert from "node:assert/strict";
import test from "node:test";
import { categoryMatchesDirection, classifyBankStatement, requiresCounterparty } from "../../components/payments/bankAutoClassify.ts";

test("расход нельзя классифицировать как продажи на маркетплейсе", () => {
  assert.equal(categoryMatchesDirection("Продажи на МП", -60_000), false);
  assert.equal(categoryMatchesDirection("УСН", -60_000), true);
});

test("поступление нельзя классифицировать как расход", () => {
  assert.equal(categoryMatchesDirection("Погашение тела кредита", 550_000), false);
  assert.equal(categoryMatchesDirection("Получение кредитов и займов", 550_000), true);
});

test("зарплате обязательно нужен контрагент", () => {
  assert.equal(requiresCounterparty("Зарплата административного персонала"), true);
  assert.equal(requiresCounterparty("УСН"), false);
});

test("статьи расходов на персонал соответствуют расходному направлению", () => {
  assert.equal(categoryMatchesDirection("Поиск и найм персонала", -25_000), true);
  assert.equal(categoryMatchesDirection("Расходы на персонал", -10_000), true);
  assert.equal(categoryMatchesDirection("Расходы на персонал", 10_000), false);
});

test("известные правила сразу подставляют статьи в банковской выписке", () => {
  const rows = [
    {
      id: "ozon",
      date: "2026-09-09",
      amount: 1_084_170.61,
      counterparty: "Интернет Решения, ООО ИНН: 7704217370",
      counterpartyInn: "",
      counterpartyAccount: "",
      purpose: "Оплата за тов. по дог. ИР-19803/20 от 24.05.2020 согл.сч. №45286684 от 17.08.26.",
      documentNumber: "1",
    },
    {
      id: "enp",
      date: "2026-09-03",
      amount: -560_842.33,
      counterparty: "Казначейство России",
      counterpartyInn: "7727406020",
      counterpartyAccount: "",
      purpose: "ЕНП Пополнение счета",
      documentNumber: "2",
    },
    {
      id: "bank-commission",
      date: "2026-09-04",
      amount: -1_500,
      counterparty: "Банк",
      counterpartyInn: "",
      counterpartyAccount: "",
      purpose: "Комиссия Банка за расчетное обслуживание",
      documentNumber: "3",
    },
  ];
  const suggestions = classifyBankStatement({
    documentHash: "hash",
    bank: "Точка",
    owner: "ИП Панкратов",
    ownerInn: "",
    accountNumber: "40702810000000000001",
    dateFrom: "2026-09-01",
    dateTo: "2026-09-30",
    openingBalance: 0,
    closingBalance: 0,
    declaredDebit: 0,
    declaredCredit: 0,
    rows,
    warnings: [],
  }, [], [], [], []);

  assert.deepEqual(suggestions.map((suggestion) => suggestion.category), ["Продажи на МП", "УСН", "РКО"]);
});

test("перевод владельцу по имени распознаётся как перевод между своими счетами", () => {
  const [suggestion] = classifyBankStatement({
    documentHash: "hash",
    bank: "Точка",
    owner: "Индивидуальный предприниматель Митриченко Кристина Михайловна",
    ownerInn: "230910032513",
    accountNumber: "40702810000000000001",
    dateFrom: "2026-09-16",
    dateTo: "2026-09-16",
    openingBalance: null,
    closingBalance: null,
    declaredDebit: 10_000,
    declaredCredit: 0,
    rows: [{
      id: "self-transfer",
      date: "2026-09-16",
      amount: -10_000,
      counterparty: 'ООО "Банк Точка"',
      counterpartyInn: "",
      counterpartyAccount: "",
      purpose: "Перевод по номеру телефона +7 909 444-53-73 Получатель Кристина Михайловна М. через СБП.",
      documentNumber: "4",
    }],
    warnings: [],
  }, [], [], [], []);

  assert.equal(suggestion.category, "Выбытие — Перевод между счетами");
  assert.match(suggestion.reasons.join(" "), /получатель перевода совпадает/i);
});

test("переводы с карты владельцу не становятся дивидендами", () => {
  const rows = [
    { id: "incoming", amount: 360_000, purpose: "Перевод на карту. Перевод от П. Максим Олегович. Операция по счету****5250" },
    { id: "outgoing", amount: -360_000, purpose: "Перевод с карты. Перевод для П. Максим Олегович. Операция по счету****5142" },
  ].map((row) => ({ ...row, date: "2026-09-23", counterparty: "П. Максим Олегович", counterpartyInn: "", counterpartyAccount: "", documentNumber: row.id }));
  const suggestions = classifyBankStatement({
    documentHash: "hash", bank: "Сбер", owner: "Панкратов Максим Олегович", ownerInn: "280888215133",
    accountNumber: "40817810000000005250", dateFrom: "2026-09-23", dateTo: "2026-09-23",
    openingBalance: null, closingBalance: null, declaredDebit: 360_000, declaredCredit: 360_000, rows, warnings: [],
  }, [], [], [], []);
  assert.deepEqual(suggestions.map(row => row.category), ["Поступление — Перевод между счетами", "Выбытие — Перевод между счетами"]);
});

test("личные категории идут в дивиденды, а перевод с включённой комиссией не становится РКО", () => {
  const purposes = [
    "Прочие расходы. YANDEX*5411*EDA.RU MOSCOW RUS.",
    "Отдых и развлечения. CP* DDX FITNESS24 MOSKVA RUS.",
    "Супермаркеты. Novruzov Ilgar Musa MOSKVA RUS.",
    "Рестораны и кафе. IP LI EBO MOSKVA RUS.",
    "Перевод с карты. SBOL. Операция по счету ****5250 В сумму операции включена комиссия 100,00 руб.",
  ];
  const rows = purposes.map((purpose, index) => ({ id: String(index), date: "2026-09-23", amount: index === 4 ? -5_100 : -500, counterparty: index === 4 ? "SBOL" : "Магазин", counterpartyInn: "", counterpartyAccount: "", purpose, documentNumber: String(index) }));
  const suggestions = classifyBankStatement({
    documentHash: "hash", bank: "Сбер", owner: "Панкратов Максим Олегович", ownerInn: "280888215133",
    accountNumber: "40817810000000005250", dateFrom: "2026-09-23", dateTo: "2026-09-23",
    openingBalance: null, closingBalance: null, declaredDebit: 7_100, declaredCredit: 0, rows, warnings: [],
  }, [], [], [], []);
  assert.deepEqual(suggestions.map(row => row.category), ["Дивиденды", "Дивиденды", "Дивиденды", "Дивиденды", null]);
});

test("процентный займ означает выдачу тела, а оплата процентов остаётся процентами", () => {
  const base = {
    documentHash: "hash",
    bank: "Ozon Банк",
    owner: "ИП Панкратов Максим Олегович",
    ownerInn: "280888215133",
    accountNumber: "40802810000000002301",
    dateFrom: "2026-09-17",
    dateTo: "2026-09-18",
    openingBalance: null,
    closingBalance: null,
    declaredDebit: 450_000,
    declaredCredit: 0,
    warnings: [],
  };
  const rows = [
    { id: "loan", date: "2026-09-17", amount: -400_000, counterparty: "Ястимова Татьяна Валерьевна", counterpartyInn: "", counterpartyAccount: "", purpose: "Перевод процентного займа №1 от 16.09.2026г.", documentNumber: "5" },
    { id: "interest", date: "2026-09-18", amount: -50_000, counterparty: "Кредитор", counterpartyInn: "", counterpartyAccount: "", purpose: "Оплата процентов по договору займа", documentNumber: "6" },
  ];
  const suggestions = classifyBankStatement({ ...base, rows }, [], [], [], []);

  assert.deepEqual(suggestions.map((suggestion) => suggestion.category), ["Выдача кредитов и займов", "Оплата % по кредиту"]);
});

test("русские ключевые слова распознают основные статьи", () => {
  const rows = [
    { id: "dividends", amount: -10_000, purpose: "Выплата дивидендов учредителю" },
    { id: "received-loan", amount: 100_000, purpose: "Получение займа по договору № 7" },
    { id: "returned-loan", amount: -25_000, purpose: "Возврат займа по договору № 7" },
    { id: "advertising", amount: -5_000, purpose: "Оплата рекламных услуг" },
    { id: "delivery", amount: -7_000, purpose: "Оплата транспортных услуг" },
  ].map((row, index) => ({
    ...row,
    date: "2026-09-20",
    counterparty: "Контрагент",
    counterpartyInn: "",
    counterpartyAccount: "",
    documentNumber: String(index + 1),
  }));

  const suggestions = classifyBankStatement({
    documentHash: "hash",
    bank: "Ozon Банк",
    owner: "ИП Панкратов Максим Олегович",
    ownerInn: "280888215133",
    accountNumber: "40802810000000002301",
    dateFrom: "2026-09-20",
    dateTo: "2026-09-20",
    openingBalance: null,
    closingBalance: null,
    declaredDebit: 47_000,
    declaredCredit: 100_000,
    rows,
    warnings: [],
  }, [], [], [], []);

  assert.deepEqual(suggestions.map((suggestion) => suggestion.category), [
    "Дивиденды",
    "Получение кредитов и займов",
    "Оплаты по кредитам и займам",
    "Внутренняя реклама на МП",
    "Доставка до маркеплейса",
  ]);
});
