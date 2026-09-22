import assert from "node:assert/strict";
import test from "node:test";
import { buildOpiuCompanyScopes, companyNamesMatch, marketplaceCabinetIdsForCompany } from "./companyScope.ts";

test("компания сопоставляется с юрлицом по нормализованному имени и известному алиасу", () => {
  assert.equal(companyNamesMatch("ИП Панкратов", "ИП ПАНКРАТОВ"), true);
  assert.equal(companyNamesMatch("Оптима", "ООО Оптима"), true);
  assert.equal(companyNamesMatch("ИП Коровкин", "ИП Филиппов"), true);
  assert.equal(companyNamesMatch("ИП Панкратов", "ИП Кучеренко"), false);
});

test("Филиппов и Коровкин становятся одним пунктом и сохраняют оба id", () => {
  const scopes = buildOpiuCompanyScopes(
    [
      { id: "kor", name: "ИП Коровкин", groupName: "Коровкин", isActive: true },
      { id: "fil", name: "ИП Филиппов", groupName: "Основная группа", isActive: true },
      { id: "shared", name: "Общая группа РИО", groupName: "Общая группа РИО", isActive: true },
    ],
    [{ id: "entity", name: "ИП Филиппов" }],
    [{ legalEntityId: "entity", cabinetId: "retail" }],
  );
  assert.deepEqual(scopes, [{
    id: "kor",
    name: "ИП Коровкин",
    groupName: "Коровкин",
    companyIds: ["kor", "fil"],
    cabinetIds: ["retail"],
  }]);
});

test("кабинеты компании берутся только из явных связей с юрлицом", () => {
  const result = marketplaceCabinetIdsForCompany(
    "ИП Панкратов",
    [{ id: "entity-p", name: "ИП ПАНКРАТОВ" }, { id: "entity-k", name: "ИП Кучеренко" }],
    [{ legalEntityId: "entity-p", cabinetId: "cabinet-p" }, { legalEntityId: "entity-k", cabinetId: "cabinet-k" }],
  );
  assert.deepEqual([...result], ["cabinet-p"]);
});

test("ООО РИО и Оптима остаются двумя независимыми компаниями", () => {
  const scopes = buildOpiuCompanyScopes([
    { id: "rio", name: "ООО РИО", groupName: "Основная группа", isActive: true },
    { id: "optima", name: "Оптима", groupName: "Оптима", isActive: true },
  ]);

  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes.find((scope) => scope.id === "rio")?.companyIds, ["rio"]);
  assert.deepEqual(scopes.find((scope) => scope.id === "optima")?.companyIds, ["optima"]);
});
