import assert from "node:assert/strict";
import test from "node:test";
import { buildImportPlan } from "./ddsImport.ts";

test("исторический ДДС Коровкина импортируется в канонический контур Филиппова", () => {
  const plan = buildImportPlan(
    {
      drafts: [{
        date: "2026-01-10",
        amount: 100_000,
        name: "Поступление",
        category: "Прочие поступл. от фин. операций",
        wallet: "Озон ИП Филиппов",
        counterparty: "",
        activity: "Финансовая",
        company: "ИП Коровкин",
      }],
      wallets: ["Озон ИП Филиппов"],
      walletDirectory: [],
      categories: ["Прочие поступл. от фин. операций"],
      totalIncome: 100_000,
      totalExpense: 0,
      skipped: 0,
      warnings: [],
    },
    { accounts: [], payments: [] },
    {
      companies: [
        { id: "kor", name: "ИП Коровкин", groupName: "Основная группа", isActive: false },
        { id: "fil", name: "ИП Филиппов", groupName: "ИП Филиппов", isActive: true },
      ],
    },
  );

  assert.equal(plan.newPaymentRows[0]?.company_id, "fil");
});

test("старый id Коровкина из банковской очереди заменяется id Филиппова", () => {
  const companies = [
    { id: "kor", name: "ИП Коровкин", groupName: "Основная группа", isActive: false },
    { id: "fil", name: "ИП Филиппов", groupName: "ИП Филиппов", isActive: true },
  ];
  const plan = buildImportPlan(
    {
      drafts: [{
        date: "2026-09-29", amount: -195, name: "Комиссия Банка", category: "РКО",
        wallet: "Озон ИП Филиппов", counterparty: "Озон Банк", activity: "Операционная",
        company: "ИП Коровкин", companyId: "kor",
      }],
      wallets: ["Озон ИП Филиппов"], walletDirectory: [], categories: ["РКО"],
      totalIncome: 0, totalExpense: 195, skipped: 0, warnings: [],
    },
    { accounts: [], payments: [] },
    { companies },
  );

  assert.equal(plan.newPaymentRows[0]?.company_id, "fil");
});
