import assert from "node:assert/strict";
import test from "node:test";
import { importedBankAccountName, importedBankAccountOpeningDate } from "./importedBankAccount.ts";

test("добавляет последние цифры счёта к понятному названию кошелька", () => {
  assert.equal(importedBankAccountName("Озон ИП Панкратов", "40802810900001234567"), "Озон ИП Панкратов · ••••4567");
  assert.equal(importedBankAccountName("Озон ••••4567", "40802810900001234567"), "Озон ••••4567");
});

test("начальный остаток привязывается к началу выписки", () => {
  assert.equal(importedBankAccountOpeningDate({ dateFrom: "2026-09-01", rows: [] }), "2026-09-01");
  assert.equal(importedBankAccountOpeningDate({ dateFrom: "", rows: [
    { id: "2", date: "2026-09-03" }, { id: "1", date: "2026-09-02" },
  ] as never[] }), "2026-09-02");
});
