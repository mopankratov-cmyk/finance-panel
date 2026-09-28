import assert from "node:assert/strict";
import test from "node:test";

import {
  categoryOptions,
  DDS_CATEGORIES,
  INTERCOMPANY_LOAN_CATEGORIES,
  isKnownCategory,
  LOAN_CATEGORIES,
  sectionForCategory,
  TRANSFER_CATEGORIES,
} from "./categories.ts";

test("справочник без дублей и пустых названий", () => {
  assert.equal(new Set(DDS_CATEGORIES).size, DDS_CATEGORIES.length);
  assert.ok(DDS_CATEGORIES.every((category) => category.trim() === category && category.length > 0));
});

test("всё, что пишут кредиты и банковская сверка, есть в справочнике", () => {
  for (const category of [...Object.values(LOAN_CATEGORIES), ...Object.values(TRANSFER_CATEGORIES), ...Object.values(INTERCOMPANY_LOAN_CATEGORIES)]) {
    assert.ok(isKnownCategory(category), `нет в справочнике: ${category}`);
  }
});

test("строки графика кредита — раздел «Финансовая», а не «Прочее»", () => {
  assert.equal(sectionForCategory(LOAN_CATEGORIES.principal), "Финансовая");
  assert.equal(sectionForCategory(LOAN_CATEGORIES.interest), "Финансовая");
  assert.equal(sectionForCategory(LOAN_CATEGORIES.penalty), "Финансовая");
  assert.equal(sectionForCategory(TRANSFER_CATEGORIES.outgoing), "Техническая");
  assert.equal(sectionForCategory(INTERCOMPANY_LOAN_CATEGORIES.issued), "Инвестиционная");
});

test("старые статьи импорта календаря получают раздел, а не «Прочее»", () => {
  assert.equal(sectionForCategory("Зарплата"), "Операционная");
  assert.equal(sectionForCategory("Кредиты и займы"), "Финансовая");
  assert.equal(sectionForCategory("Воврат кредитов и займов"), "Инвестиционная");
  assert.equal(sectionForCategory("что-то неизвестное"), "Прочее");
  assert.equal(sectionForCategory(""), "Прочее");
});

test("опции формы не теряют текущую статью, которой нет в справочнике", () => {
  const options = categoryOptions("Старая статья из выгрузки");
  assert.ok(options.includes("Старая статья из выгрузки"));
  assert.equal(options.length, DDS_CATEGORIES.length + 1);
  assert.deepEqual(options, [...options].sort((left, right) => left.localeCompare(right, "ru")));
  const sortedRegistry = [...DDS_CATEGORIES].sort((left, right) => left.localeCompare(right, "ru"));
  assert.deepEqual(categoryOptions(LOAN_CATEGORIES.principal), sortedRegistry);
  assert.deepEqual(categoryOptions(""), sortedRegistry);
  assert.deepEqual(categoryOptions(undefined), sortedRegistry);
});
