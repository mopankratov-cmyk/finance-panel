import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_ALIAS_PROMPT_NOTE, companyAliasKeys, sameCompanyAlias } from "./companyAliases.ts";

test("Филиппов и Коровкин — одна группа, чужие — нет", () => {
  assert.equal(sameCompanyAlias("ИП Филиппов Иван", "ИП Коровкин"), true);
  assert.equal(sameCompanyAlias("ИП Коровкин", "ИП Кучеренко"), false);
  assert.equal(sameCompanyAlias("ООО Ромашка", "ООО Ромашка"), false, "без группы — не алиас (сравнивайте имена напрямую)");
  assert.deepEqual([...companyAliasKeys("Индивидуальный предприниматель Филиппов")], ["филиппов", "коровкин"]);
  assert.deepEqual([...companyAliasKeys("ООО Ромашка")], []);
});

test("промпт получает формулировку из справочника", () => {
  assert.match(COMPANY_ALIAS_PROMPT_NOTE, /ИП Филиппов и ИП Коровкин — одно юридическое лицо/);
});
