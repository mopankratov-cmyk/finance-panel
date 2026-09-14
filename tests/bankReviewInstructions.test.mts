import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBankInstructionList, balanceBankSplits, splitBankTotal } from "../components/payments/bankInstructionSplits";
import type { BankReviewItem } from "../components/payments/bankReviewStore";
const item = (id: string, amount: number) => ({ id, date: "2026-09-11", amount, companyId: "company", accountId: "wallet" } as BankReviewItem);
test("recognizes conversational explanation and preserves the 10000 remainder", () => {
 const rows = parseBankInstructionList("11 сентября 10т перевела с карты Андрею Коровкину дивиденды\nиз 55т - 5 тысяч Ефремова зп, 10т Митриченко зп, 30т ушли на карту Артема филиппова", [item("dividend", -10000), item("payroll", -55000)], [], 2026);
 assert.equal(rows.length, 2);
 assert.equal(rows[0].itemId, "dividend");
 assert.equal(rows[0].splits[0].category, "Дивиденды");
 assert.equal(rows[1].itemId, "payroll");
 assert.deepEqual(rows[1].splits.map(s => s.amount), [5000, 10000, 30000, 10000]);
 assert.equal(rows[1].splits[0].category, "Зарплата административного персонала");
 assert.equal(rows[1].splits[3].isRemainder, true);
 assert.equal(splitBankTotal(item("payroll", -55000), rows[1].splits), -55000);
});
test("remainder updates for both directions and excluded amounts stay in bank total", () => {
 for (const amount of [-55000, 55000]) {
 const source = item("bank", amount);
 const part = {id: "part", amount: 5000, description: "salary", category: null, companyId: null, excluded: true, needsClarification: false};
 const splits = balanceBankSplits(source, [part]);
 assert.equal(splits[1].amount, 50000);
 const updated = balanceBankSplits(source, [{...splits[0], amount: 10000}, splits[1]]);
 assert.equal(updated.length, 2);
 assert.equal(updated[1].amount, 45000);
 assert.equal(splitBankTotal(source, updated), amount);
 }
});
test("does not choose between same-date same-amount bank operations", () => {
 const rows = parseBankInstructionList("11.09\n10т дивиденды", [item("one", -10000), item("two", -10000)], [], 2026);
 assert.equal(rows[0].itemId, null);
});
