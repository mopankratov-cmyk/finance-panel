import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { salesPlanForecastUnavailableLabel } from "../lib/planning/salesPlan";

test("visible SKU forecast label preserves the calculated unavailable reason", () => {
  assert.equal(
    salesPlanForecastUnavailableLabel("SKU или остаток не найден в актуальном каталоге"),
    "Прогноз недоступен: SKU или остаток не найден в актуальном каталоге",
  );

  const table = readFileSync(
    new URL("../components/planning/SalesPlanTable.tsx", import.meta.url),
    "utf8",
  );
  assert.match(table, /salesPlanForecastUnavailableLabel\(stockRisk\.unavailableReason\)/);
});
