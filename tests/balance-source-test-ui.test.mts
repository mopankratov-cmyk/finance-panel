import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/balance/BalancePage.tsx", import.meta.url), "utf8");

test("сухой прогон Баланса показывает количественные итоги товарных источников", () => {
  assert.match(source, /summaries: StockSourceTestSummary\[\]/);
  assert.match(source, /Товарные остатки/);
  assert.match(source, /quantity\(item\.quantity\).*шт\./s);
  assert.match(source, /item\.rows.*позиций/s);
  assert.match(source, /money\(item\.totalValue\)/);
  assert.match(source, /item\.missingCostCount/);
});
