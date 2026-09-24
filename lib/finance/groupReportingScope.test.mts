import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupReportingScope } from "./groupReportingScope.ts";

test("внешний селлер без компании ОПиУ исключается из отчётности группы", () => {
  const scope = buildGroupReportingScope(
    [
      { name: "ИП Панкратов", is_active: true },
      { name: "Общая группа РИО", is_active: true },
    ],
    [
      { id: "pankratov", name: "ИП Панкратов" },
      { id: "external", name: "СЛОЁНО" },
    ],
    [
      { legal_entity_id: "pankratov", cabinet_id: "wb-own" },
      { legal_entity_id: "external", cabinet_id: "wb-external" },
    ],
  );

  assert.deepEqual([...scope.legalEntityIds], ["pankratov"]);
  assert.deepEqual([...scope.cabinetIds], ["wb-own"]);
});

test("неактивная компания не открывает кабинет в Баланс", () => {
  const scope = buildGroupReportingScope(
    [{ name: "ООО Архив", is_active: false }],
    [{ id: "archived", name: "ООО Архив" }],
    [{ legal_entity_id: "archived", cabinet_id: "wb-archived" }],
  );

  assert.equal(scope.legalEntityIds.size, 0);
  assert.equal(scope.cabinetIds.size, 0);
});
