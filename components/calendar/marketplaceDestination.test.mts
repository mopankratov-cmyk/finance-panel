import assert from "node:assert/strict";
import test from "node:test";
import type { Payment } from "../../lib/types.ts";
import { recommendWbDestination } from "./marketplaceDestination.ts";

const payment = (patch: Partial<Payment>): Payment => ({
  id: "p1", date: "2026-08-01", name: "Поступление Wildberries", amount: 100,
  category: "Продажи на МП", accountId: "a1", status: "done", ...patch,
});

test("uses an exact previous cabinet publication before bank history", () => {
  const result = recommendWbDestination("cab-1", [
    payment({ id: "old", status: "planned", comment: "[forecast-marketplace:wb] [forecast-cabinet:cab-1] [forecast-company:c1]" }),
    payment({ id: "fact", accountId: "a2" }),
  ], new Map([["fact", "c2"]]));
  assert.deepEqual(result, { companyId: "c1", accountId: "a1", source: "previous_publication" });
});

test("does not guess when bank history contains multiple destinations", () => {
  const result = recommendWbDestination("cab-1", [
    payment({ id: "one", accountId: "a1" }), payment({ id: "two", accountId: "a2" }),
  ], new Map([["one", "c1"], ["two", "c2"]]));
  assert.equal(result, null);
});
