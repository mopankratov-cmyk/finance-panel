import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("WB RNP page exposes a management focus summary above the wide table", () => {
  const source = readFileSync(new URL("../components/wb/WbRnpPage.tsx", import.meta.url), "utf8");

  assert.match(source, /buildRnpFocusSummary\(sortedSkus\)/);
  assert.match(source, /Фокус по текущему срезу/);
  assert.match(source, /ДРР = реклама \/ заказы/);
  assert.match(source, /focusSummary\.signals\.map/);
});
