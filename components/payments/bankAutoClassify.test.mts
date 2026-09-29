import assert from "node:assert/strict";
import test from "node:test";
import { classifyBankStatement } from "./bankAutoClassify.ts";

test("неактивная привязка Коровкина не перетягивает выписку Филиппова", () => {
  const suggestions = classifyBankStatement(
    {
      documentHash: "statement",
      bank: "Озон Банк",
      owner: "ИП Филиппов Артем Сергеевич",
      ownerInn: "330573647518",
      accountNumber: "40802810900000016002",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      openingBalance: 0,
      closingBalance: -195,
      declaredDebit: 195,
      declaredCredit: 0,
      warnings: [],
      rows: [{
        id: "row-1",
        date: "2026-09-29",
        amount: -195,
        counterparty: "ООО ОЗОН Банк",
        counterpartyInn: "9703077050",
        counterpartyAccount: "",
        purpose: "Комиссия Банка по операции. Без НДС.",
        documentNumber: "1",
      }],
    },
    [{ id: "ozon", name: "ИП Филиппов Озон · ••••6002", type: "bank", currency: "RUB", balance: 0 }],
    [
      { id: "kor", name: "ИП Коровкин", groupName: "Основная группа", isActive: false },
      { id: "fil", name: "ИП Филиппов", groupName: "ИП Филиппов", isActive: true },
    ],
    [],
    [{ bankAccountNumber: "40802810900000016002", ownerInn: "330573647518", companyId: "kor", accountId: "ozon" }],
  );

  assert.equal(suggestions[0]?.companyId, "fil");
  assert.equal(suggestions[0]?.accountId, "ozon");
  assert.equal(suggestions[0]?.category, "РКО");
});
