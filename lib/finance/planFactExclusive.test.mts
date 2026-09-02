import assert from "node:assert/strict";
import test from "node:test";
import { findPlanFactMatches } from "../../components/calendar/calendarPlan.ts";
import type { Payment } from "../types.ts";

const base = { category: "Закуп товара", accountId: "a-1", counterparty: "ООО Поставщик", name: "Оплата ткани" };
const plan = (id: string, amount: number, date = "2026-09-10"): Payment => ({ id, date, amount, status: "planned", ...base });
const fact = (id: string, amount: number, date = "2026-09-10"): Payment => ({ id, date, amount, status: "done", ...base });
const links = new Map<string, string | null>([["p-1", "c-1"], ["f-1", "c-1"], ["f-2", "c-1"], ["loan-row", "c-1"]]);

test("факт, уже закрывший строку графика кредита, не предлагается плану календаря", () => {
  const loanRow: Payment = { id: "loan-row", date: "2026-09-10", amount: -100_000, status: "cancelled", category: "Погашение тела кредита", accountId: "a-1", counterparty: "Банк", name: "Погашение тела", comment: "[loan:1:schedule:r:principal] [paid-by:f-1]" };
  const result = findPlanFactMatches([plan("p-1", -100_000), fact("f-1", -100_000), loanRow], links);
  assert.equal(result.matched.length, 0);
  assert.equal(result.review.length, 0);
});

test("совпадение всех реквизитов при расхождении суммы на 30% — на проверку, а не автозакрытие", () => {
  const result = findPlanFactMatches([plan("p-1", -100_000), fact("f-1", -70_000)], links);
  assert.equal(result.matched.length, 0, "автоматически не закрывается");
  assert.equal(result.review.length, 1, "но показывается на проверку");
});

test("та же сумма и реквизиты — автоматическое совпадение", () => {
  const result = findPlanFactMatches([plan("p-1", -100_000), fact("f-1", -100_000, "2026-09-11")], links);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].source, "automatic");
});

test("подтверждённая вручную связь остаётся, даже если сумма отличалась", () => {
  const confirmed: Payment = { ...plan("p-1", -100_000), status: "cancelled", comment: "[calendar-fact:f-2]" };
  const result = findPlanFactMatches([confirmed, fact("f-2", -70_000)], links);
  assert.equal(result.matched.length, 1);
  assert.equal(result.matched[0].source, "confirmed");
});
