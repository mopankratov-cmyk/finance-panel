import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Payment } from "../../lib/types";
import { loanPaymentCandidates, loanPurposeScore, requiresLoanAmountConfirmation } from "./manualLoanPayment";

const fact = (overrides: Partial<Payment> = {}): Payment => ({
  id: "cash-fact",
  date: "2026-09-10",
  name: "Оплата кредита",
  amount: -10_000,
  category: "Погашение тела кредита",
  accountId: "cash-account",
  companyId: "company-a",
  importSource: "manual-dds:cash-fact",
  status: "done",
  counterparty: "Банк",
  ...overrides,
});

test("наличная операция входит в кандидаты на оплату кредита", () => {
  const candidates = loanPaymentCandidates(
    [fact()], new Set(), new Map([["cash-fact", "company-a"]]), "company-a", 10_000, "2026-09-10",
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].payment.accountId, "cash-account");
  assert.equal(candidates[0].sameCompany, true);
});

test("планы, поступления и уже занятые факты выбрать нельзя", () => {
  const rows = [
    fact({ id: "plan", status: "planned" }),
    fact({ id: "income", amount: 10_000 }),
    fact({ id: "used" }),
  ];
  assert.deepEqual(loanPaymentCandidates(rows, new Set(["used"]), new Map(), null, 10_000, "2026-09-10"), []);
});

test("сначала предлагается та же компания, затем ближайшая сумма и дата", () => {
  const rows = [
    fact({ id: "other-company", amount: -10_000 }),
    fact({ id: "same-company-later", amount: -10_000, date: "2026-09-12" }),
    fact({ id: "same-company-exact", amount: -10_000 }),
  ];
  const companies = new Map([
    ["other-company", "company-b"], ["same-company-later", "company-a"], ["same-company-exact", "company-a"],
  ]);
  assert.deepEqual(
    loanPaymentCandidates(rows, new Set(), companies, "company-a", 10_000, "2026-09-10").map((item) => item.payment.id),
    ["same-company-exact", "same-company-later", "other-company"],
  );
});

test("разница больше одного процента требует явного подтверждения", () => {
  assert.equal(requiresLoanAmountConfirmation(-10_100, 10_000), false);
  assert.equal(requiresLoanAmountConfirmation(-10_101, 10_000), true);
});

test("пояснение из назначения поднимает платёж нужного заёмщика выше одинаковой суммы", () => {
  const rows = [
    fact({ id: "generic", name: "Возврат займа", counterparty: "Физлицо" }),
    fact({ id: "korovkin", name: "Возврат займа Андрею Коровкину", counterparty: "Андрей Коровкин" }),
  ];
  const candidates = loanPaymentCandidates(rows, new Set(), new Map(), null, 10_000, "2026-09-10", "Коровкин Андрей");
  assert.deepEqual(candidates.map((item) => item.payment.id), ["korovkin", "generic"]);
  assert.ok(candidates[0].purposeScore > candidates[1].purposeScore);
  assert.ok(loanPurposeScore(rows[1], "Коровкин Андрей") > 0);
});

test("сервер принимает для закрытия графика только настоящий факт ДДС", () => {
  const route = readFileSync(new URL("../../app/api/finance/loans/schedule/route.ts", import.meta.url), "utf8");
  assert.match(route, /select\("id,status,amount,import_source"\)/);
  assert.match(route, /!isDdsActualPayment\(fact\)/);
});
