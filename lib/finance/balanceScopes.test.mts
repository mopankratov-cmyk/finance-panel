import assert from "node:assert/strict";
import test from "node:test";
import { buildBalanceCompanyScopes } from "./balanceScopes.ts";

test("Retail Family and Optima remain separate balance scopes", () => {
  const scopes = buildBalanceCompanyScopes([
    { id: "korovkin", name: "ИП Коровкин", group_name: null, is_active: true },
    { id: "retail", name: "ИП Филиппов", group_name: null, is_active: true },
    { id: "optima", name: "ООО Оптима", group_name: null, is_active: true },
  ], [
    { id: "entity-retail", name: "ИП Филиппов" },
    { id: "entity-optima", name: "ООО Оптима" },
    { id: "entity-sloeno", name: "WB СЛОЁНО" },
  ], [
    { legal_entity_id: "entity-retail", cabinet_id: "wb-retail", relation: "own" },
    { legal_entity_id: "entity-retail", cabinet_id: "wb-optima", relation: "agent" },
    { legal_entity_id: "entity-optima", cabinet_id: "wb-optima", relation: "own" },
    { legal_entity_id: "entity-sloeno", cabinet_id: "wb-sloeno", relation: "own" },
  ], [
    { id: "wb-retail", name: "Retail Family" },
    { id: "wb-optima", name: "Оптима — NORVIA / RIOBOX" },
    { id: "wb-sloeno", name: "СЛОЁНО" },
  ]);

  assert.deepEqual(scopes.map((scope) => ({ id: scope.id, name: scope.name, cabinets: scope.cabinetIds })), [
    { id: "optima", name: "Оптима — NORVIA / RIOBOX (ООО Оптима)", cabinets: ["wb-optima"] },
    { id: "korovkin", name: "Retail Family (ИП Филиппов)", cabinets: ["wb-retail"] },
  ]);
  assert.deepEqual(scopes.find((scope) => scope.id === "korovkin")?.companyIds.sort(), ["korovkin", "retail"]);
  assert.equal(scopes.some((scope) => scope.cabinetIds.includes("wb-sloeno")), false);
});
