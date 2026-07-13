import assert from "node:assert/strict";
import test from "node:test";
import { currentMoscowMonth, wbRnpCacheIdentity, wbRnpCacheTag } from "../lib/rnp/tableCache";

test("WB RNP snapshot isolates cabinets and periods", () => {
  const all = wbRnpCacheIdentity({ from: "2026-07-01", to: "2026-07-31", cabinetId: null });
  const cabinet = wbRnpCacheIdentity({ from: "2026-07-01", to: "2026-07-31", cabinetId: "cab-a", label: "Optima" });
  const nextMonth = wbRnpCacheIdentity({ from: "2026-08-01", to: "2026-08-31", cabinetId: null });
  assert.notEqual(all, cabinet);
  assert.notEqual(all, nextMonth);
});

test("WB RNP snapshot tag is compact", () => {
  const tag = wbRnpCacheTag({ from: "2026-07-01", to: "2026-07-31", cabinetId: "cab-a", label: "Optima" });
  assert.match(tag, /^wb-rnp:[a-f0-9]{32}$/);
  assert.ok(tag.length < 256);
  assert.equal(tag.includes("Optima"), false);
});

test("WB RNP hourly warmup uses the Moscow calendar month", () => {
  assert.deepEqual(currentMoscowMonth(new Date("2026-07-31T21:30:00.000Z")), {
    from: "2026-08-01",
    to: "2026-08-31",
  });
});
