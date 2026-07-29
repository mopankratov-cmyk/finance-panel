import assert from "node:assert/strict";
import test from "node:test";
import { buildFunnelMetrics } from "../lib/rnp/buildTable";

test("RNP keeps an unsynchronised funnel day empty instead of presenting a real zero", () => {
  const metrics = buildFunnelMetrics(
    ["2026-07-01", "2026-07-02"],
    "2026-07-02",
    new Map(),
    new Map(),
    new Map([["2026-07-02", 100]]),
    new Map([["2026-07-02", 10]]),
    { adverts: null, funnel: "2026-07-02" },
  );

  assert.deepEqual(metrics.find((metric) => metric.field === "open_card")?.daily, [null, 100]);
  assert.deepEqual(metrics.find((metric) => metric.field === "cart")?.daily, [null, 10]);
});
