import assert from "node:assert/strict";
import test from "node:test";
import { transferCategories } from "./bankTransferClassification.ts";

test("перевод между разными юрлицами становится выдачей и получением займа", () => {
  assert.deepEqual(transferCategories("ip-kucherenko", "ip-korovkin"), {
    outgoing: "Выдача кредитов и займов",
    incoming: "Получение кредитов и займов",
  });
});

test("перевод между счетами одного юрлица остаётся внутренним", () => {
  assert.deepEqual(transferCategories("ip-kucherenko", "ip-kucherenko"), {
    outgoing: "Выбытие — Перевод между счетами",
    incoming: "Поступление — Перевод между счетами",
  });
});
