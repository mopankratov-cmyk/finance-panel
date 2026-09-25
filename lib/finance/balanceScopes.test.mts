import assert from "node:assert/strict";
import test from "node:test";
import { buildBalanceCompanyScopes } from "./balanceScopes.ts";

test("Retail Family and Optima remain separate balance scopes", () => {
  const scopes = buildBalanceCompanyScopes([
    { id: "retail", name: "ООО Ритейл Фэмили", group_name: null, is_active: true },
    { id: "optima", name: "ООО Оптима", group_name: null, is_active: true },
  ], [
    { id: "entity-retail", name: "Ритейл Фэмили" },
    { id: "entity-optima", name: "Оптима" },
    { id: "entity-sloeno", name: "WB СЛОЁНО" },
  ], [
    { legal_entity_id: "entity-retail", cabinet_id: "wb-retail" },
    { legal_entity_id: "entity-optima", cabinet_id: "wb-optima" },
    { legal_entity_id: "entity-sloeno", cabinet_id: "wb-sloeno" },
  ]);

  assert.deepEqual(scopes.map((scope) => ({ id: scope.id, cabinets: scope.cabinetIds })), [
    { id: "optima", cabinets: ["wb-optima"] },
    { id: "retail", cabinets: ["wb-retail"] },
  ]);
  assert.equal(scopes.some((scope) => scope.cabinetIds.includes("wb-sloeno")), false);
});
