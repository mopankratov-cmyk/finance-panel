import assert from "node:assert/strict";
import test from "node:test";
import { marketplacePayoutDate } from "./marketplacePayoutDate.ts";

test("выплата ставится через три недели после воскресенья отчётной недели", () => {
  assert.equal(marketplacePayoutDate("2026-09-06"), "2026-09-30");
  assert.equal(marketplacePayoutDate("2026-09-09"), "2026-10-07");
  assert.equal(marketplacePayoutDate("2026-09-10"), "2026-10-07");
  assert.equal(marketplacePayoutDate("2026-09-20"), "2026-10-14");
});

test("части одной недели по разные стороны месяца получают одну дату выплаты", () => {
  assert.equal(marketplacePayoutDate("2026-09-30"), "2026-10-28");
  assert.equal(marketplacePayoutDate("2026-10-04"), "2026-10-28");
});

test("некорректная дата отчёта не превращается в выдуманный план", () => {
  assert.equal(marketplacePayoutDate(""), "");
  assert.equal(marketplacePayoutDate("2026-02-31"), "");
});
