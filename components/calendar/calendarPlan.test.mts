import assert from "node:assert/strict";
import test from "node:test";
import { findPlanFactMatches, withCalendarFactLink } from "./calendarPlan.ts";
import type { Payment } from "../../lib/types.ts";

const payment = (id: string, status: Payment["status"], amount: number, date = "2026-08-10"): Payment => ({
  id, status, amount, date, name: "Выплата Wildberries", category: "Поступление — Продажи на МП", accountId: "wb", counterparty: "Wildberries",
});

test("не сопоставляет одинаковые платежи разных компаний", () => {
  const result = findPlanFactMatches(
    [payment("plan", "planned", 100000), payment("fact", "done", 100000)],
    new Map([["plan", "rio"], ["fact", "kucher"]]),
  );
  assert.equal(result.matched.length, 0);
  assert.equal(result.review.length, 0);
});

test("точная сумма, компания и счет дают автоматическое совпадение", () => {
  const result = findPlanFactMatches(
    [payment("plan", "planned", 100000), payment("fact", "done", 100000, "2026-08-11")],
    new Map([["plan", "rio"], ["fact", "rio"]]),
  );
  assert.equal(result.matched[0]?.fact.id, "fact");
});

test("ручное подтверждение сохраняет устойчивую связь", () => {
  const plan = withCalendarFactLink(payment("plan", "planned", 100000), "fact");
  const result = findPlanFactMatches([plan, payment("fact", "done", 70000, "2026-08-15")]);
  assert.equal(result.matched[0]?.source, "confirmed");
});

test("расход не сопоставляется с поступлением", () => {
  const result = findPlanFactMatches([payment("plan", "planned", -1000), payment("fact", "done", 1000)]);
  assert.equal(result.matched.length, 0);
});
