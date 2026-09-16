import assert from "node:assert/strict";
import test from "node:test";
import { companyGroupLabel, companyLabel, companyScopeOptions } from "./ddsCompanies.ts";

test("старая общая группа показывается как не распределённые по компаниям операции", () => {
  assert.equal(companyLabel("Общая группа РИО"), "Не распределено по компаниям");
  assert.equal(companyLabel("Основная группа"), "Не распределено по компаниям");
  assert.equal(companyGroupLabel("РИО / ИП Панкратов / ИП Кучеренко"), "Основная группа");
  assert.equal(companyGroupLabel("Общая группа РИО"), "Основная группа");
  assert.equal(companyLabel("ИП Митриченко"), "ИП Митриченко");
});

test("алиасы Коровкина показываются одним пунктом без Филиппова", () => {
  const options = companyScopeOptions([
    { id: "kor", name: "ИП Коровкин", groupName: "Коровкин", isActive: true },
    { id: "fil", name: "ИП Филиппов", groupName: "Коровкин", isActive: true },
    { id: "one", name: "ООО Одно", groupName: "Одиночная", isActive: true },
    { id: "off", name: "ООО Архив", groupName: "Коровкин", isActive: false },
  ]);

  assert.deepEqual(options.groups, [{ name: "Коровкин", label: "ИП Коровкин" }]);
  assert.deepEqual(options.companies.map((company) => company.name), ["ООО Одно"]);
  assert.deepEqual(options.unassignedCompanyIds, []);
});

test("настоящая группа остаётся группой, а её компании доступны отдельно", () => {
  const options = companyScopeOptions([
    { id: "a", name: "ООО А", groupName: "Основная", isActive: true },
    { id: "b", name: "ООО Б", groupName: "Основная", isActive: true },
  ]);

  assert.deepEqual(options.groups, [{ name: "Основная", label: "Группа «Основная» — все компании" }]);
  assert.deepEqual(options.companies.map((company) => company.name), ["ООО А", "ООО Б"]);
});

test("основная группа прямо подписана как совокупность всех компаний", () => {
  const options = companyScopeOptions([
    { id: "a", name: "ООО РИО", groupName: "Основная группа", isActive: true },
    { id: "b", name: "ИП Митриченко", groupName: "Основная группа", isActive: true },
  ]);

  assert.equal(options.groups[0]?.label, "Основная группа");
});

test("техническая карточка общих расходов скрывается и входит в нераспределённые", () => {
  const options = companyScopeOptions([
    { id: "shared", name: "Не распределено по компаниям", groupName: "Основная группа", isActive: true },
    { id: "rio", name: "ООО РИО", groupName: "Основная группа", isActive: true },
  ]);

  assert.deepEqual(options.unassignedCompanyIds, ["shared"]);
  assert.deepEqual(options.companies.map((company) => company.name), ["ООО РИО"]);
});
