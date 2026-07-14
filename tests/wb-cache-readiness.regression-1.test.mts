import assert from "node:assert/strict";
import test from "node:test";
import {
  WB_CACHE_PROGRESS_JOBS,
  WB_CACHE_REQUIRED_JOBS,
  wbCacheProgressReadiness,
  wbCacheReadiness,
} from "../lib/sync/wbCacheReadiness";

test("WB cache is published only after every required source succeeds recently", () => {
  const now = Date.parse("2026-07-14T20:00:00Z");
  const healthy = WB_CACHE_REQUIRED_JOBS.map((job) => ({ job, status: "ok", error: null, finished_at: "2026-07-14T19:30:00Z" }));
  assert.equal(wbCacheReadiness(healthy, now).ready, true);

  const failed = healthy.map((row) => row.job === "funnel" ? { ...row, status: "error", error: "WB 429" } : row);
  assert.equal(wbCacheReadiness(failed, now).ready, false);
  assert.deepEqual(wbCacheReadiness(failed, now).failed, ["funnel"]);
});

test("WB cache waits for every cabinet cursor and a scoped product catalogue", () => {
  const rows = [
    ...WB_CACHE_PROGRESS_JOBS.map((job) => ({ cabinet_id: "full", job, status: "caught_up", last_error: null })),
    ...WB_CACHE_PROGRESS_JOBS.map((job) => ({ cabinet_id: "optima", job, status: "caught_up", last_error: null })),
    { cabinet_id: "optima", job: "product-scope", status: "caught_up", last_error: null },
  ];
  const cabinets = [{ id: "full", scoped: false }, { id: "optima", scoped: true }];
  assert.equal(wbCacheProgressReadiness(rows, cabinets).ready, true);
  const partial = rows.map((row) => row.cabinet_id === "optima" && row.job === "funnel" ? { ...row, status: "running" } : row);
  assert.deepEqual(wbCacheProgressReadiness(partial, cabinets).incomplete, ["optima:funnel"]);
});
