import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/finance/balance-stock/route.ts", import.meta.url), "utf8");

test("предварительная стоимость остатков видна, но не считается подтверждённой", () => {
  assert.match(route, /const amountReady = categoryRuns\.length > 0/);
  assert.match(route, /amount: amountReady \? round2/);
  assert.match(route, /!run\.provisional/);
  assert.doesNotMatch(route, /amount: complete \? round2\(categoryRuns/);
});
