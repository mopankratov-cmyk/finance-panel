import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { syncFreshness } from "../lib/sync/freshness";

const NOW = Date.parse("2026-07-14T13:00:00.000Z");

test("hourly sync becomes missed after the grace window", () => {
  assert.deepEqual(syncFreshness({ status: "ok", finished_at: "2026-07-14T12:00:00.000Z" }, NOW), { state: "ok", ageMinutes: 60 });
  assert.deepEqual(syncFreshness({ status: "ok", finished_at: "2026-07-14T11:29:00.000Z" }, NOW), { state: "missed", ageMinutes: 91 });
});

test("sync errors and jobs that never ran are distinct from missed cron", () => {
  assert.deepEqual(syncFreshness({ status: "error", finished_at: "2026-07-14T12:55:00.000Z" }, NOW), { state: "error", ageMinutes: 5 });
  assert.deepEqual(syncFreshness(null, NOW), { state: "never", ageMinutes: null });
});

test("sync screen documents the actual staggered WB schedules", async () => {
  const source = await readFile(new URL("../components/sync/SyncPage.tsx", import.meta.url), "utf8");
  assert.match(source, /Продажи WB", schedule: "каждый час, :02"/);
  assert.match(source, /Остатки WB", schedule: "каждый час, :04"/);
  assert.match(source, /пропущен/);
});
