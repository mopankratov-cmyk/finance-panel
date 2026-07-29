import assert from "node:assert/strict";
import test from "node:test";
import {
  formatUnitPeriod,
  getDefaultUnitPeriod,
  parseUnitPeriodQuery,
  unitPeriodCacheIdentity,
} from "../lib/unit/period";

test("Moscow default follows Moscow date when UTC is still yesterday", () => {
  assert.deepEqual(getDefaultUnitPeriod(new Date("2026-07-31T21:30:00.000Z")), {
    from: "2026-08-01",
    to: "2026-08-01",
  });
});

test("missing from and to use the Moscow current month", () => {
  assert.deepEqual(parseUnitPeriodQuery(new URLSearchParams(), new Date("2026-07-18T12:00:00.000Z")), {
    from: "2026-07-01",
    to: "2026-07-18",
  });
});

for (const [name, query] of [
  ["partial", "from=2026-07-01"],
  ["malformed", "from=2026-7-01&to=2026-07-18"],
  ["impossible", "from=2026-02-30&to=2026-03-01"],
  ["reverse", "from=2026-07-18&to=2026-07-01"],
  ["future", "from=2026-07-18&to=2026-07-19"],
  ["32 inclusive days", "from=2026-06-17&to=2026-07-18"],
] as const) {
  test(`${name} period is rejected`, () => {
    assert.throws(() => parseUnitPeriodQuery(new URLSearchParams(query), new Date("2026-07-18T12:00:00.000Z")));
  });
}

test("31 inclusive days are accepted", () => {
  assert.deepEqual(
    parseUnitPeriodQuery(new URLSearchParams("from=2026-06-18&to=2026-07-18"), new Date("2026-07-18T12:00:00.000Z")),
    { from: "2026-06-18", to: "2026-07-18" },
  );
});

test("cache identity distinguishes both boundaries and formatter is exact", () => {
  const base = { cabinetId: null, taxPct: 7, ff: 0, targetMargin: 25 };
  assert.notDeepEqual(
    unitPeriodCacheIdentity({ ...base, from: "2026-07-01", to: "2026-07-18" }),
    unitPeriodCacheIdentity({ ...base, from: "2026-07-02", to: "2026-07-18" }),
  );
  assert.notDeepEqual(
    unitPeriodCacheIdentity({ ...base, from: "2026-07-01", to: "2026-07-18" }),
    unitPeriodCacheIdentity({ ...base, from: "2026-07-01", to: "2026-07-17" }),
  );
  assert.equal(formatUnitPeriod({ from: "2026-07-01", to: "2026-07-18" }), "01.07.2026–18.07.2026");
});
