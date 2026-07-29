import assert from "node:assert/strict";
import test from "node:test";
import { readDashboardFilter, writeDashboardFilter } from "../lib/useDashboardFilter";

test("reads a valid filter and rejects unsupported values", () => {
  assert.equal(readDashboardFilter(new URLSearchParams("days=30"), "days", "7", ["1", "7", "30"]), "30");
  assert.equal(readDashboardFilter(new URLSearchParams("days=365"), "days", "7", ["1", "7", "30"]), "7");
});

test("writes non-default filters while preserving cabinet scope", () => {
  const params = new URLSearchParams("cabinet=optima");
  writeDashboardFilter(params, "days", "30", "7");
  assert.equal(params.toString(), "cabinet=optima&days=30");
  writeDashboardFilter(params, "days", "7", "7");
  assert.equal(params.toString(), "cabinet=optima");
});
