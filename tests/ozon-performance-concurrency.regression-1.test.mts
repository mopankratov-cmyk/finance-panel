import assert from "node:assert/strict";
import test from "node:test";
import { perfProductReport, runWithConcurrency, type PerfProductReportResumeState } from "../lib/ozon/performance";

// Regression: ISSUE-004 — five simultaneous Ozon async reports failed for both cabinets
// Found by /qa on 2026-07-14
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-14.md
test("Ozon Performance report generation is bounded to two concurrent batches", async () => {
  let active = 0;
  let maxActive = 0;
  const results = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
});

test("Ozon Performance concurrency never becomes zero", async () => {
  const results = await runWithConcurrency(["campaign"], 0, async (value) => value);
  assert.deepEqual(results, ["campaign"]);
});

test("Ozon Performance resumes a saved async UUID instead of creating a new report", async (t) => {
  const originalFetch = globalThis.fetch;
  let createCalls = 0;
  let ready = false;
  let saved: PerfProductReportResumeState | null = null;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/api/client/token")) return Response.json({ access_token: "token" });
    if (url.endsWith("/api/client/campaign")) {
      return Response.json({ list: [{ id: "campaign-1", advObjectType: "SKU" }] });
    }
    if (url.endsWith("/api/client/statistics/json")) {
      createCalls += 1;
      return Response.json({ UUID: "saved-uuid" });
    }
    if (url.endsWith("/api/client/statistics/saved-uuid")) {
      return Response.json({ state: ready ? "OK" : "IN_PROGRESS" });
    }
    if (url.includes("/api/client/statistics/report?UUID=saved-uuid")) {
      return Response.json({ campaign: { report: { rows: [{ sku: "sku-1", moneySpent: "12,5", ordersMoney: "100" }] } } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const first = await perfProductReport(
    { clientId: "client", secret: "secret" },
    "2026-07-01T00:00:00.000Z",
    "2026-07-14T23:59:59.999Z",
    60,
    { allowPending: true, pollAttempts: 1, pollIntervalMs: 0, onState: (state) => { saved = state; } },
  );
  assert.equal(first?.complete, false);
  assert.equal(createCalls, 1);
  const persisted = saved as PerfProductReportResumeState | null;
  assert.equal(persisted?.batches[0]?.uuid, "saved-uuid");

  ready = true;
  const second = await perfProductReport(
    { clientId: "client", secret: "secret" },
    "2026-07-01T00:00:00.000Z",
    "2026-07-14T23:59:59.999Z",
    60,
    { allowPending: true, resumeState: persisted, pollAttempts: 1, pollIntervalMs: 0 },
  );
  assert.equal(second?.complete, true);
  assert.equal(createCalls, 1);
  assert.deepEqual(second?.bySku, { "sku-1": { spent: 12.5, ordersMoney: 100 } });
});

test("Ozon Performance covers every campaign across resumable batch-limited runs", async (t) => {
  const originalFetch = globalThis.fetch;
  const campaignIds = Array.from({ length: 25 }, (_, index) => String(index + 1));
  let createCalls = 0;
  let saved: PerfProductReportResumeState | null = null;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/api/client/token")) return Response.json({ access_token: "token" });
    if (url.endsWith("/api/client/campaign")) {
      return Response.json({ list: campaignIds.map((id) => ({ id, advObjectType: "SKU" })) });
    }
    if (url.endsWith("/api/client/statistics/json")) {
      createCalls += 1;
      return Response.json({ UUID: `uuid-${createCalls}` });
    }
    if (/\/api\/client\/statistics\/uuid-\d+$/.test(url)) return Response.json({ state: "OK" });
    if (url.includes("/api/client/statistics/report?UUID=")) {
      const uuid = url.split("UUID=")[1];
      return Response.json({ campaign: { report: { rows: [{ sku: uuid, moneySpent: "1", ordersMoney: "2" }] } } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  for (let run = 0; run < 3; run++) {
    const report = await perfProductReport(
      { clientId: "client", secret: "secret" },
      "2026-07-01T00:00:00.000Z",
      "2026-07-14T23:59:59.999Z",
      10_000,
      {
        allowPending: true,
        resumeState: saved,
        pollAttempts: 1,
        pollIntervalMs: 0,
        maxBatchesPerRun: 1,
        onState: (state) => { saved = state; },
      },
    );
    assert.equal(report?.resumeState.campaignIds.length, 25);
    assert.equal(report?.resumeState.batches.length, 3);
    assert.equal(report?.complete, run === 2);
    saved = report?.resumeState ?? null;
  }

  assert.equal(createCalls, 3);
  assert.equal(saved?.batches.every((batch) => batch.done), true);
});
