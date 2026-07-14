import assert from "node:assert/strict";
import test from "node:test";
import { applyEconomyMetricCoverage, type Metric } from "../lib/rnp/buildTable";

const metric = (total: number | null): Metric => ({
  field: "gmroi",
  label: "GMROI, %",
  kind: "pct",
  daily: [null],
  total,
  forecast: null,
  coveragePct: 0,
  status: "unavailable",
});

test("GMROI total cannot remain unavailable with zero coverage", () => {
  const gmroi = metric(3.4);
  applyEconomyMetricCoverage(gmroi, 67.8, "Себестоимость известна для 97 из 143 SKU.");
  assert.equal(gmroi.total, 3.4);
  assert.equal(gmroi.coveragePct, 67.8);
  assert.equal(gmroi.status, "partial");
  assert.equal(gmroi.qualityReason, "missing_cost");
});

test("GMROI without a calculable total remains unavailable", () => {
  const gmroi = metric(null);
  applyEconomyMetricCoverage(gmroi, 67.8, "Себестоимость известна частично.");
  assert.equal(gmroi.coveragePct, 0);
  assert.equal(gmroi.status, "unavailable");
  assert.equal(gmroi.qualityReason, "missing_cost");
});
