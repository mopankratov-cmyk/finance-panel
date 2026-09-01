import assert from "node:assert/strict";
import test from "node:test";
import { categoryMatchesDirection, requiresCounterparty } from "../../components/payments/bankAutoClassify.ts";

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
