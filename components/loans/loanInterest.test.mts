import assert from "node:assert/strict";
import test from "node:test";
import { fixedMonthlyInterest } from "./loanInterest.ts";

test("monthly loan interest is fixed and rounded to tenths", () => {
  assert.equal(fixedMonthlyInterest(5_000_000, 38), 158_333.3);
});
