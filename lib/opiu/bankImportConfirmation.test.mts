import assert from "node:assert/strict";
import test from "node:test";
import { submittedCategoryIsConfirmed } from "./bankImportConfirmation.ts";

test("сохранение просмотренной выписки подтверждает уже заполненную статью", () => {
  assert.equal(submittedCategoryIsConfirmed({ category: "Дивиденды" }, true), true);
});

test("пустая статья остаётся на проверке", () => {
  assert.equal(submittedCategoryIsConfirmed({ category: "  " }, true), false);
});

test("почтовый импорт не подтверждает статью без просмотра человеком", () => {
  assert.equal(submittedCategoryIsConfirmed({ category: "Дивиденды", categoryConfirmed: true }, false), false);
});
