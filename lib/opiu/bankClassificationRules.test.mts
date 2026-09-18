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

  assert.deepEqual(suggestions.map((suggestion) => suggestion.category), ["Продажи на МП", "УСН"]);
});
