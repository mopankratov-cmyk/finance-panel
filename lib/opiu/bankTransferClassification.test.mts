import assert from "node:assert/strict";
import test from "node:test";
import { transferCategories } from "./bankTransferClassification.ts";

const pankratov = { id: "pankratov", name: "ИП Панкратов", groupName: "Основная группа" };
const mitrichenko = { id: "mitrichenko", name: "ИП Митриченко", groupName: "Основная группа" };
const filippov = { id: "filippov", name: "ИП Филиппов", groupName: "Филиппов" };
const korovkin = { id: "korovkin", name: "ИП Коровкин", groupName: "Филиппов" };
const outsider = { id: "outsider", name: "ООО Поставщик", groupName: "Поставщики" };

test("перевод из основной группы Филиппову становится выдачей и получением займа", () => {
  assert.deepEqual(transferCategories(pankratov, filippov), {
    outgoing: "Выдача кредитов и займов",
    incoming: "Получение кредитов и займов",
  });
});

test("разные юрлица основной группы остаются обычным переводом", () => {
  assert.deepEqual(transferCategories(pankratov, mitrichenko), {
    outgoing: "Выбытие — Перевод между счетами",
    incoming: "Поступление — Перевод между счетами",
  });
});

test("Коровкин использует то же специальное правило, что Филиппов", () => {
  assert.deepEqual(transferCategories(pankratov, korovkin), {
    outgoing: "Выдача кредитов и займов",
    incoming: "Получение кредитов и займов",
  });
});

test("разные компании сами по себе не превращают перевод в займ", () => {
  assert.deepEqual(transferCategories(pankratov, outsider), {
    outgoing: "Выбытие — Перевод между счетами",
    incoming: "Поступление — Перевод между счетами",
  });
});

test("перевод между счетами одного юрлица остаётся обычным", () => {
  assert.deepEqual(transferCategories(pankratov, pankratov), {
    outgoing: "Выбытие — Перевод между счетами",
    incoming: "Поступление — Перевод между счетами",
  });
});
