import assert from "node:assert/strict";
import test from "node:test";
import { buildDdsSummary } from "./ddsSummary.ts";

test("groups empty and whitespace-only categories as without category", () => {
  const summary = buildDdsSummary([
    { amount: -1_000, category: "", date: "2026-09-01", status: "done" },
    { amount: -2_000, category: "   ", date: "2026-09-02", status: "done" },
  ]);

  assert.equal(summary.groups.length, 1);
  assert.equal(summary.groups[0]?.section, "Прочее");
  assert.deepEqual(summary.groups[0]?.rows, [
    { category: "Без статьи", income: 0, expense: 3_000, net: -3_000 },
  ]);
});

test("keeps a named miscellaneous category separate from payments without category", () => {
  const summary = buildDdsSummary([
    { amount: -1_000, category: "Прочее", date: "2026-09-01", status: "done" },
    { amount: -2_000, category: "", date: "2026-09-02", status: "done" },
  ]);

  assert.deepEqual(summary.groups[0]?.rows.map((row) => row.category).sort(), ["Без статьи", "Прочее"]);
});
