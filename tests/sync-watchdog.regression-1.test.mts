import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SYNC_WATCHDOG_SLA_MINUTES,
  syncWatchdogHealth,
  type SyncWatchdogLogRow,
} from "../lib/sync/watchdogHealth";

const now = Date.parse("2026-08-01T12:00:00Z");

function row(job: string, overrides: Partial<SyncWatchdogLogRow> = {}): SyncWatchdogLogRow {
  return {
    job,
    status: "ok",
    error: null,
    started_at: "2026-08-01T11:00:00Z",
    finished_at: "2026-08-01T11:01:00Z",
    ...overrides,
  };
}

test("sync watchdog accepts a recent successful result for every required job", () => {
  const rows = Object.keys(SYNC_WATCHDOG_SLA_MINUTES).map((job) => row(job));
  const health = syncWatchdogHealth(rows, now);
  assert.equal(health.ok, true);
  assert.deepEqual(health.issues, []);
});

test("sync watchdog reports the actual failed or stale job without inventing missing jobs", () => {
  const rows = Object.keys(SYNC_WATCHDOG_SLA_MINUTES).map((job) => row(job));
  rows.push(row("stocks", { status: "error", error: "WB timeout", finished_at: "2026-08-01T11:30:00Z" }));
  rows.push(row("sales", { finished_at: "2026-08-01T08:00:00Z" }));

  const health = syncWatchdogHealth(rows, now);
  assert.equal(health.ok, false);
  assert.deepEqual(health.issues.map((issue) => [issue.job, issue.kind]), [
    ["stocks", "failed"],
  ]);
});

test("sync watchdog rejects missing and truly stale sources", () => {
  const rows = Object.keys(SYNC_WATCHDOG_SLA_MINUTES)
    .filter((job) => job !== "orders")
    .map((job) => row(job, job === "sales" ? { finished_at: "2026-08-01T08:00:00Z" } : {}));
  const health = syncWatchdogHealth(rows, now);
  assert.deepEqual(health.issues.map((issue) => [issue.job, issue.kind]), [
    ["sales", "stale"],
    ["orders", "missing"],
  ]);
});

test("watchdog endpoint is self-authenticated and database errors cannot become seven fake missing jobs", async () => {
  const [route, proxy] = await Promise.all([
    readFile(new URL("../app/api/sync/watchdog/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /SYNC_WATCHDOG_SECRET/);
  assert.match(route, /status: 502/);
  assert.match(route, /syncWatchdogHealth/);
  assert.match(proxy, /\/api\/sync\/watchdog/);
});

test("stocks sync stops before the Vercel hard timeout and still writes sync_log", async () => {
  const source = await readFile(new URL("../app/api/sync/stocks/route.ts", import.meta.url), "utf8");
  assert.match(source, /export const maxDuration = 300/);
  assert.match(source, /const deadline = Date\.now\(\) \+ 280_000/);
  assert.match(source, /синхронизация перенесена на следующий запуск из-за лимита времени/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.match(source, /ожидание отчёта остатков перенесено на следующий запуск/);
  assert.match(source, /writeSyncLog\("stocks"/);
});
