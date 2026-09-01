import assert from "node:assert/strict";
import test from "node:test";
import { selectPendingTelegramPayment } from "./telegramPaymentReply.ts";

const item = (id: string, messageId?: number) => ({ id, reasons: messageId ? [`__telegram_message_id:${messageId}`] : [] });

test("ответ на сообщение связывается с точным платежом", () => {
  assert.equal(selectPendingTelegramPayment([item("old", 10), item("target", 20)], 20)?.id, "target");
});

test("единственный ожидающий платеж принимает обычный текстовый ответ", () => {
  assert.equal(selectPendingTelegramPayment([item("only")])?.id, "only");
});

test("обычный ответ относится к последнему заданному вопросу", () => {
  assert.equal(selectPendingTelegramPayment([item("old", 10), item("latest", 30)])?.id, "latest");
});

test("неоднозначный ответ не назначается случайному платежу", () => {
  assert.equal(selectPendingTelegramPayment([item("one"), item("two")]), null);
});
