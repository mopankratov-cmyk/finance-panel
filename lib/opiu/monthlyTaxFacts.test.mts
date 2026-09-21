import assert from "node:assert/strict";
import test from "node:test";
import { withCalculatedMonthlyTaxes } from "./monthlyTaxFacts.ts";

test("НДС и УСН считаются от выручки маркетплейса после СПП", () => {
  const facts = withCalculatedMonthlyTaxes({
    company: { id: "1", name: "Оптима", groupName: "Основная группа", vatMode: "5", taxSystem: "usn_income", taxRate: 6 },
    marketplaceTaxBase: 105_000,
    ebitda: 40_000,
  });
  assert.equal(facts?.vat.amount, 5_000);
  assert.equal(facts?.taxes.amount, 6_300);
  assert.equal(facts?.vat.status, "partial");
});

test("подтверждённые налоги и НДС не заменяются расчётными", () => {
  const facts = withCalculatedMonthlyTaxes({
    company: { id: "1", name: "Оптима", groupName: "Основная группа", vatMode: "22", taxSystem: "usn_income", taxRate: 6 },
    marketplaceTaxBase: 100_000,
    ebitda: 30_000,
    shared: {
      vat: { amount: 1_000, status: "complete" },
      taxes: { amount: 2_000, status: "complete" },
    },
  });
  assert.equal(facts?.vat.amount, 1_000);
  assert.equal(facts?.taxes.amount, 2_000);
});
