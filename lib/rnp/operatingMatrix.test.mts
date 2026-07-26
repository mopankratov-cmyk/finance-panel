import assert from "node:assert/strict";
import test from "node:test";

import {
  detectSkuAnomalies,
  matchesArticleList,
  metricDelta,
  parseArticleList,
  previousEqualRange,
  sanitizeMetricFields,
} from "./operatingMatrix";

test("previous RNP comparison range has the same inclusive length", () => {
  assert.deepEqual(previousEqualRange("2026-07-01", "2026-07-31"), {
    from: "2026-05-31",
    to: "2026-06-30",
  });
  assert.deepEqual(previousEqualRange("2026-07-20", "2026-07-26"), {
    from: "2026-07-13",
    to: "2026-07-19",
  });
});

test("article list accepts lines, commas and WB ids without duplicates", () => {
  assert.deepEqual(parseArticleList("HT-80-11,\nESCO0124; 1244157 HT-80-11"), [
    "ht-80-11",
    "esco0124",
    "1244157",
  ]);
  assert.equal(matchesArticleList({ nm: 1244157, art: "HT-80-11", name: "Ветровка" }, "1244157\nOTHER"), true);
  assert.equal(matchesArticleList({ nm: 1, art: "HT-80-11", name: "Ветровка" }, "ESCO0124"), false);
});

test("saved metric configuration is restricted to known unique fields", () => {
  assert.deepEqual(sanitizeMetricFields(["orders_sum", "orders_sum", "hacked", "drr"]), ["orders_sum", "drr"]);
  assert.ok(sanitizeMetricFields(null).length > 0);
});

test("metric deltas preserve zero-base uncertainty", () => {
  assert.deepEqual(metricDelta(120, 100), { absolute: 20, percent: 20, direction: "up" });
  assert.deepEqual(metricDelta(20, 0), { absolute: 20, percent: null, direction: "up" });
  assert.equal(metricDelta(null, 10), null);
});

test("anomaly detector understands beneficial and harmful directions", () => {
  const previous = {
    nm: 1,
    art: "A",
    name: "A",
    metrics: [
      { field: "orders_sum", kind: "money", total: 100 },
      { field: "drr", kind: "pct", total: 20 },
    ],
  };
  const current = {
    nm: 1,
    art: "A",
    name: "A",
    metrics: [
      { field: "orders_sum", kind: "money", total: 60 },
      { field: "drr", kind: "pct", total: 27 },
    ],
  };

  assert.deepEqual(
    detectSkuAnomalies(current, previous).map((anomaly) => [anomaly.field, anomaly.direction]),
    [["orders_sum", "negative"], ["drr", "negative"]],
  );
});
