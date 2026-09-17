import assert from "node:assert/strict";
import test from "node:test";
import { isDdsActualPayment, isManualDdsPayment, manualDdsCashAccounts } from "./bankDdsPayment.ts";

test("ДДС показывает подтверждённые строки банковских выписок и их разбивки", () => {
  assert.equal(isDdsActualPayment({ status: "done", importSource: "bank-review:row-id" }), true);
  assert.equal(isDdsActualPayment({ status: "done", importSource: "dds-chain:chain-id:1:part-id" }), true);
  assert.equal(isDdsActualPayment({ status: "done", importSource: "manual-dds:payment-id" }), true);
  assert.equal(isManualDdsPayment({ importSource: "manual-dds:payment-id" }), true);
});

test("ДДС не смешивается с календарём, ручными и отменёнными строками", () => {
  assert.equal(isDdsActualPayment({ status: "planned", importSource: "manual-dds:payment-id" }), false);
  assert.equal(isDdsActualPayment({ status: "done", importSource: null }), false);
  assert.equal(isDdsActualPayment({ status: "cancelled", importSource: "bank-review:row-id" }), false);
});

test("кошелёк, используемый только календарём, не предлагается для ручного ДДС", () => {
  const accounts = [
    { id: "plan", name: "PANKSTER GROUP", type: "cash" as const, currency: "RUB" as const, balance: 0 },
    { id: "cash", name: "Касса", type: "cash" as const, currency: "RUB" as const, balance: 0 },
  ];
  const payments = [{
    id: "plan-row", date: "2026-09-17", name: "План", amount: -100,
    category: "Прочее", accountId: "plan", status: "planned" as const, counterparty: "",
  }];
  assert.deepEqual(manualDdsCashAccounts(accounts, payments).map((account) => account.id), ["cash"]);
});
