import assert from "node:assert/strict";
import test from "node:test";
import { displayPaymentComment, editablePaymentComment } from "./paymentPriority.ts";

const technical = "[loan:abc:schedule:row:principal] [origination-fee:0] [fee-months:36] [contract:ИП Панкратов JetLend займ № 22612 обновленный.pdf] [priority:A]";

test("технические маркеры превращаются в читаемый комментарий", () => {
  assert.equal(displayPaymentComment(technical), "Договор: ИП Панкратов JetLend займ № 22612 обновленный.pdf");
});

test("в поле редактирования остаётся только пользовательский текст", () => {
  assert.equal(editablePaymentComment(`Платёж по договору ${technical}`), "Платёж по договору");
});
