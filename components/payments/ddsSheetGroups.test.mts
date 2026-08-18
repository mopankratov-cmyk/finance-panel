import assert from "node:assert/strict";
import test from "node:test";
import { ddsSheetNameForCompany } from "./ddsSheetGroups.ts";

const company = (id: string, name: string) => ({ id, name, groupName: "", isActive: true });

test("Коровкин и Филиппов выгружаются на один отдельный лист", () => {
  assert.equal(ddsSheetNameForCompany(company("1", "ИП Коровкин")), "ДДС Коровкин-Филиппов");
  assert.equal(ddsSheetNameForCompany(company("2", "ИП Филиппов")), "ДДС Коровкин-Филиппов");
});

test("основная группа компаний выгружается вместе", () => {
  assert.equal(ddsSheetNameForCompany(company("1", "ИП Панкратов")), "ДДС Группа компаний");
  assert.equal(ddsSheetNameForCompany(company("2", "ООО РИО")), "ДДС Группа компаний");
  assert.equal(ddsSheetNameForCompany(company("3", "Прайм Бьюти")), "ДДС Группа компаний");
});

test("новое самостоятельное юрлицо получает отдельный лист", () => {
  assert.equal(ddsSheetNameForCompany(company("1", "ООО Оптима")), "ДДС ООО Оптима");
  assert.equal(ddsSheetNameForCompany(null), "ДДС На проверке");
});
