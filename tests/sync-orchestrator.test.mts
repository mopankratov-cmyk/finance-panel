import assert from "node:assert/strict";
import test from "node:test";

import { runCoreSyncJobs } from "../lib/sync/orchestrator";

test("independent sync jobs run concurrently and advert stats waits for adverts", async () => {
  let active = 0;
  let maxActive = 0;
  let advertsFinished = false;
  const started: string[] = [];

  const fakeFetch = async (input: string | URL | Request) => {
    const job = String(input).split("/").pop()!;
    started.push(job);
    if (job === "advert-stats") {
      assert.equal(advertsFinished, true);
    } else {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      if (job === "adverts") advertsFinished = true;
    }
    return new Response(JSON.stringify({ ok: true, rows: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await runCoreSyncJobs("https://example.test", {}, fakeFetch as typeof fetch);
  assert.equal(result.ok, true);
  assert.equal(maxActive, 4);
  assert.deepEqual(started.slice(0, 4).sort(), ["adverts", "orders", "sales", "stocks"]);
  assert.equal(started[4], "advert-stats");
});

test("downstream job failures make the aggregate sync fail", async () => {
  const fakeFetch = async (input: string | URL | Request) => {
    const failed = String(input).endsWith("/sales");
    return new Response(JSON.stringify(failed ? { ok: false, error: "WB 401" } : { ok: true }), {
      status: failed ? 502 : 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await runCoreSyncJobs("https://example.test", {}, fakeFetch as typeof fetch);
  assert.equal(result.ok, false);
  assert.deepEqual(result.results.sales, { ok: false, error: "WB 401", status: 502 });
});
