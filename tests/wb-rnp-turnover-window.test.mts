import assert from "node:assert/strict";
import test from "node:test";

import { calculateTurnoverDays } from "../lib/rnp/buildTable";

test("RNP turnover uses only the requested latest observation window", () => {
  assert.equal(calculateTurnoverDays(120, [2, 2, 2, 10, 10, 10], 3), 12);
  assert.equal(calculateTurnoverDays(120, [2, 2, 2, 10, 10, 10], 6), 20);
});

test("RNP turnover ignores missing source days but keeps real zero days", () => {
  assert.equal(calculateTurnoverDays(90, [null, 0, 3, 3], 3), 45);
  assert.equal(calculateTurnoverDays(90, [null, null], 30), null);
  assert.equal(calculateTurnoverDays(90, [0, 0], 30), null);
});
