import assert from "node:assert/strict";
import test from "node:test";
import { parseBankInstructionList, splitTotal } from "./bankInstructionSplits.ts";
import type { BankReviewItem } from "./bankReviewStore.ts";

const item = (id: string, date: string, amount: number): BankReviewItem => ({
  id, batchId: "b", documentHash: "h", sourceFileName: "x", externalId: id, date, amount,
  bankAccountNumber: "1", ownerInn: "", companyId: null, accountId: "wallet", counterparty: "",
  counterpartyInn: "", purpose: "", category: null, confidence: 0, reasons: [], status: "needs_info",
  matchedTransferId: null, managerQuestion: null, managerAnswer: null,
});

test("parses a composite bank operation and reconciles every kopeck", () => {
  const parsed = parseBankInstructionList(
    "13.07\n101000 - 53000 зп Романюк, 40т зп Митриченко, 4000 - ПО, программа марпла для ип панкратов, 3638 - рекламный кабинет филиппова, 362 р комиссия",
    [item("payment", "2026-07-13", -101000)],
    [{ id: "p", name: "ИП Панкратов", groupName: "Группа", isActive: true }, { id: "k", name: "ИП Коровкин", groupName: "Коровкин", isActive: true }],
    2026,
  );
  assert.equal(parsed[0].itemId, "payment");
  assert.equal(parsed[0].splits.length, 5);
  assert.equal(splitTotal(parsed[0].splits), 101000);
  assert.equal(parsed[0].splits[2].category, "ПО");
  assert.equal(parsed[0].splits[3].companyId, "k");
  assert.equal(parsed[0].splits[4].category, "РКО");
});

test("marks a personal withdrawal as excluded and exposes the stated total mismatch", () => {
  const parsed = parseBankInstructionList(
    "30.07\n5027 - 4500 отправила на т банк, 100р комиссия, 487р забрала свои с расчетного счета, их никак не вносить в ддс",
    [item("payment", "2026-07-30", -5027)], [], 2026,
  );
  assert.equal(splitTotal(parsed[0].splits), 5087);
  assert.equal(parsed[0].splits[2].excluded, true);
});

test("exposes a mismatch instead of silently changing the bank amount", () => {
  const parsed = parseBankInstructionList("23.07\n360 - 300р телефон, 50р перевод", [item("p", "2026-07-23", -360)], [], 2026);
  assert.equal(splitTotal(parsed[0].splits), 350);
});
