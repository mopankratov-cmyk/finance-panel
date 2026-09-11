import assert from "node:assert/strict";
import test from "node:test";
import { companyNamesMatch, marketplaceCabinetIdsForCompany } from "./companyScope.ts";

test("компания сопоставляется с юрлицом по нормализованному имени и известному алиасу", () => {
  assert.equal(companyNamesMatch("ИП Панкратов", "ИП ПАНКРАТОВ"), true);
  assert.equal(companyNamesMatch("ИП Коровкин", "ИП Филиппов"), true);
  assert.equal(companyNamesMatch("ИП Панкратов", "ИП Кучеренко"), false);
});

test("кабинеты компании берутся только из явных связей с юрлицом", () => {
  const result = marketplaceCabinetIdsForCompany(
    "ИП Панкратов",
    [{ id: "entity-p", name: "ИП ПАНКРАТОВ" }, { id: "entity-k", name: "ИП Кучеренко" }],
    [{ legalEntityId: "entity-p", cabinetId: "cabinet-p" }, { legalEntityId: "entity-k", cabinetId: "cabinet-k" }],
  );
  assert.deepEqual([...result], ["cabinet-p"]);
});
