import assert from "node:assert/strict";
import test from "node:test";
import { marketplacePayoutDate } from "./marketplacePayoutDate.ts";

test("выплата ставится на первую среду не раньше трёх недель после отчёта", () => {
  assert.equal(marketplacePayoutDate("2026-09-06"), "2026-09-30");
  assert.equal(marketplacePayoutDate("2026-09-09"), "2026-09-30");
  assert.equal(marketplacePayoutDate("2026-09-10"), "2026-10-07");
});

test("некорректная дата отчёта не превращается в выдуманный план", () => {
  assert.equal(marketplacePayoutDate(""), "");
  assert.equal(marketplacePayoutDate("2026-02-31"), "");
});
