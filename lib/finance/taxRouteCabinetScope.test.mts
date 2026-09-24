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
  assert.match(source, /loadWbAdvertisingExpense\(selected\.cabinetIds,/);
  assert.match(source, /loadWbAdvertisingCoverageStart\(selected\.cabinetIds\)/);
  assert.match(source, /rpc\("tax_wb_advert_expense"/);
});

test("tax page includes report services and full-cabinet advertising in USN without duplicating WB documents", () => {
  const page = readFileSync(new URL("../../components/taxes/TaxesPage.tsx", import.meta.url), "utf8");
  assert.match(page, /automaticMarketplaceExpenses = money\(marketplace\.serviceExpensesExAdvertising \+ advertisingExpense\)/);
  assert.match(page, /document\.marketplace === "other" && document\.usnExpenseStatus === "included"/);
  assert.match(page, /marketplaceExpensesGross: \(register\?\.yearSettings\.recognizedCogs \?\? 0\) \+ automaticMarketplaceExpenses \+ additionalMpExpenses/);
  assert.match(page, /advertisingCoverageIncomplete/);
});
