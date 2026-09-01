import assert from "node:assert/strict";
import test from "node:test";

import { decideBid, orderRulesBySafety, ruleFactValue, type BidRule, type BidRuleFact } from "./bidRules.ts";
import { judgeDeposit, type DepositAllowance } from "./depositLimits.ts";

const RULE: BidRule = {
  id: "r1",
  advertId: 100,
  nmId: null,
  goal: "drr",
  target: 15,
  windowDays: 3,
  stepPercent: 10,
  minBid: 100,
  maxBid: 1000,
  minOrders: 5,
  enabled: true,
};

const fact = (over: Partial<BidRuleFact> = {}): BidRuleFact => ({ spent: 10_000, orders: 20, ordersSum: 50_000, ...over });

test("нет расхода — правило молчит, а не считает ДРР нулём", () => {
  const decision = decideBid(RULE, fact({ spent: 0 }), 500);
  assert.equal(decision.action, "hold");
  assert.match(decision.reason, /расхода не было/);
});

test("мало заказов — правило не реагирует на шум", () => {
  const decision = decideBid(RULE, fact({ orders: 4 }), 500);
  assert.equal(decision.action, "hold");
  assert.match(decision.reason, /Мало данных/);
});

test("ДРР без продаж не считается", () => {
  assert.equal(ruleFactValue("drr", fact({ ordersSum: 0 })), null);
  assert.equal(ruleFactValue("cpo", fact({ orders: 0 })), null);
});

test("ДРР выше цели — ставка вниз на шаг", () => {
  // spent 10000 / ordersSum 40000 = 25% при цели 15% → снижаем на 10%
  const decision = decideBid(RULE, fact({ ordersSum: 40_000 }), 500);
  assert.equal(decision.action, "lower");
  assert.equal(decision.newBid, 450);
});

test("ДРР заметно ниже цели — ставка вверх на шаг", () => {
  // 10000 / 200000 = 5% при цели 15%
  const decision = decideBid(RULE, fact({ ordersSum: 200_000 }), 500);
  assert.equal(decision.action, "raise");
  assert.equal(decision.newBid, 550);
});

test("мёртвая зона: у цели ставку не трогаем", () => {
  // 10000 / 66667 ≈ 15,0% — ровно цель
  const atTarget = decideBid(RULE, fact({ ordersSum: 66_667 }), 500);
  assert.equal(atTarget.action, "hold");
  // 16% — всё ещё в пределах ±10% от цели 15%
  const nearTarget = decideBid(RULE, fact({ ordersSum: 62_500 }), 500);
  assert.equal(nearTarget.action, "hold");
  assert.match(nearTarget.reason, /у цели/);
});

test("потолок сильнее шага", () => {
  const decision = decideBid({ ...RULE, maxBid: 520 }, fact({ ordersSum: 200_000 }), 500);
  assert.equal(decision.action, "raise");
  assert.equal(decision.newBid, 520);
  assert.match(decision.reason, /упёрлись в границу/);
});

test("на границе правило останавливается, а не повторяет то же значение", () => {
  const decision = decideBid({ ...RULE, minBid: 500 }, fact({ ordersSum: 40_000 }), 500);
  assert.equal(decision.action, "hold");
  assert.match(decision.reason, /минимуме 500/);
});

test("выключенное правило не решает ничего", () => {
  assert.equal(decideBid({ ...RULE, enabled: false }, fact(), 500).action, "hold");
});

test("перевёрнутые границы не превращаются в случайную ставку", () => {
  const decision = decideBid({ ...RULE, minBid: 900, maxBid: 100 }, fact({ ordersSum: 40_000 }), 500);
  assert.equal(decision.action, "hold");
  assert.match(decision.reason, /наоборот/);
});

test("CPO считается на заказ, а не на сумму", () => {
  // 10000 / 20 = 500 при цели 300 → дороже цели, снижаем
  const decision = decideBid({ ...RULE, goal: "cpo", target: 300 }, fact(), 500);
  assert.equal(decision.action, "lower");
  assert.equal(decision.newBid, 450);
});

test("снижения идут раньше повышений", () => {
  const items = [
    { decision: decideBid(RULE, fact({ ordersSum: 200_000 }), 500) },
    { decision: decideBid(RULE, fact({ spent: 0 }), 500) },
    { decision: decideBid(RULE, fact({ ordersSum: 40_000 }), 500) },
  ];
  assert.deepEqual(orderRulesBySafety(items).map((item) => item.decision.action), ["lower", "hold", "raise"]);
});

/* ------------------------------------------------------------------ */

const allowance = (over: Partial<DepositAllowance> = {}): DepositAllowance => ({
  spentToday: 0,
  maxPerOperation: 10_000,
  maxPerDay: 30_000,
  remainingToday: 30_000,
  ...over,
});

test("пополнение ниже минимума WB не уходит в сеть", () => {
  const verdict = judgeDeposit({ sum: 100, minTopUp: 1000, allowance: allowance() });
  assert.equal(verdict.allowed, false);
});

test("потолок операции ловит лишний ноль", () => {
  const verdict = judgeDeposit({ sum: 50_000, minTopUp: 500, allowance: allowance() });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.allowed === false ? verdict.reason : "", /Потолок одной операции/);
});

test("суточный лимит ловит повторы в рамках потолка", () => {
  const verdict = judgeDeposit({ sum: 5_000, minTopUp: 500, allowance: allowance({ spentToday: 28_000, remainingToday: 2_000 }) });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.allowed === false ? verdict.reason : "", /Суточный лимит/);
});

test("дробная сумма отклоняется: WB ждёт целое", () => {
  assert.equal(judgeDeposit({ sum: 1500.5, minTopUp: 500, allowance: allowance() }).allowed, false);
});

test("сумма в рамках всех границ проходит", () => {
  assert.equal(judgeDeposit({ sum: 5_000, minTopUp: 500, allowance: allowance() }).allowed, true);
});
