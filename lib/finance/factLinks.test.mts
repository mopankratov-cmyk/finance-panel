import assert from "node:assert/strict";
import test from "node:test";
import { consumedFactIds, hasFactLink, linkedFactIds, preservedLoanMarkers } from "./factLinks.ts";

test("собирает id фактов из обеих меток", () => {
  assert.deepEqual(linkedFactIds("[loan:1:schedule:r:principal] [paid-by:f-1]"), ["f-1"]);
  assert.deepEqual(linkedFactIds("план [calendar-fact:f-2]"), ["f-2"]);
  assert.deepEqual(linkedFactIds(undefined), []);
  assert.equal(hasFactLink("[paid-by:x]"), true);
  assert.equal(hasFactLink("без меток"), false);
});

test("занятые факты — по всем планам, кроме исключённого", () => {
  const payments = [
    { id: "p-1", comment: "[calendar-fact:f-1]" },
    { id: "p-2", comment: "[loan:1:schedule:r:interest] [paid-by:f-2]" },
    { id: "p-3", comment: null },
  ];
  assert.deepEqual([...consumedFactIds(payments)].sort(), ["f-1", "f-2"]);
  assert.deepEqual([...consumedFactIds(payments, "p-1")], ["f-2"]);
});

test("при пересборке строки графика сохраняются метки оплаты и переноса", () => {
  const comment = "[loan:1:schedule:r:principal] [currency:RUB] [paid-by:f-9] [original-due:2026-03-15] [overdue-calendar-date:2026-09-01]";
  assert.equal(preservedLoanMarkers(comment), "[paid-by:f-9] [original-due:2026-03-15] [overdue-calendar-date:2026-09-01]");
  assert.equal(preservedLoanMarkers("[loan:1:schedule:r:principal] [currency:RUB]"), "");
});
