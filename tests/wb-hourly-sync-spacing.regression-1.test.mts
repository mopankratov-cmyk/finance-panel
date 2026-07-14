import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  runCoreSyncJobs,
  WB_HOURLY_CORE_SYNC_OPTIONS,
} from "../lib/sync/orchestrator";

// Regression: ISSUE-003 — concurrent WB orders/sales/stocks hit the seller global limiter
// Found by /qa on 2026-07-14
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-14.md
test("hourly core sync leaves sales and stocks to their staggered cron slots", async () => {
  const called: string[] = [];
  const result = await runCoreSyncJobs(
    "https://example.test",
    {},
    (async (input: string | URL | Request) => {
      called.push(new URL(String(input)).pathname.split("/").pop()!);
      return Response.json({ ok: true });
    }) as typeof fetch,
    WB_HOURLY_CORE_SYNC_OPTIONS,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(called.sort(), ["advert-stats", "adverts", "orders"]);
});

test("Vercel runs seller statistics and stocks in separate minute slots", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const schedules = new Map(config.crons.map((cron) => [cron.path, cron.schedule]));

  assert.equal(schedules.get("/api/sync/all?hourly=1"), "0 * * * *");
  assert.equal(schedules.get("/api/sync/sales"), "2 * * * *");
  assert.equal(schedules.get("/api/sync/stocks"), "4 * * * *");
});

test("manual WB refresh still includes sales and stocks", async () => {
  const called: string[] = [];
  const result = await runCoreSyncJobs(
    "https://example.test",
    {},
    (async (input: string | URL | Request) => {
      called.push(new URL(String(input)).pathname.split("/").pop()!);
      return Response.json({ ok: true });
    }) as typeof fetch,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(called.sort(), ["advert-stats", "adverts", "orders", "sales", "stocks"]);
});

test("only the scheduled hourly orchestrator opts out of duplicate sales and stocks", () => {
  const source = readFileSync(new URL("../app/api/sync/all/route.ts", import.meta.url), "utf8");
  assert.match(source, /searchParams\.get\("hourly"\) === "1"/);
  assert.match(source, /hourlyCron \? WB_HOURLY_CORE_SYNC_OPTIONS : \{\}/);
});
