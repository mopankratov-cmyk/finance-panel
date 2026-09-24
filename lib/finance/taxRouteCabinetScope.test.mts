import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../../app/api/finance/taxes/route.ts", import.meta.url), "utf8");

test("tax route loads legal-entity cabinet links for live WB VAT", () => {
  assert.match(source, /from\("legal_entities"\)\.select\("id,name"\)/);
  assert.match(source, /from\("legal_entity_cabinets"\)\.select\("legal_entity_id,cabinet_id"\)/);
  assert.match(source, /legalEntityId:\s*String\(row\.legal_entity_id\)/);
  assert.match(source, /cabinetId:\s*String\(row\.cabinet_id\)/);
  assert.match(source, /loadWbReportedInputVat\(selected\.cabinetIds,/);
});
