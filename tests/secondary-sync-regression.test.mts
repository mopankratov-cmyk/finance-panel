import assert from "node:assert/strict";
import test from "node:test";

import { runIndependentSyncJobs } from "../lib/sync/orchestrator";
import { getWbCommission } from "../lib/wb/commissions";

test("secondary sync jobs run concurrently and propagate a nested failure", async () => {
  let active = 0;
  let maxActive = 0;
  const fakeFetch = async (input: string | URL | Request) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    const failed = String(input).endsWith("/feedbacks");
    return new Response(JSON.stringify(failed ? { ok: false, error: "WB 401" } : { ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await runIndependentSyncJobs(
    ["commissions", "feedbacks", "ozon-adverts"],
    "https://example.test",
    {},
    fakeFetch as typeof fetch,
  );
  assert.equal(maxActive, 3);
  assert.equal(result.ok, false);
  assert.deepEqual(result.results.feedbacks, { ok: false, error: "WB 401", status: 200 });
});

test("large WB commission reports bypass the Next.js data cache", async () => {
  const originalFetch = globalThis.fetch;
  let observedInit: RequestInit | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    observedInit = init;
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await getWbCommission(30, { token: "test-token", cacheKey: `test-${Date.now()}` });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(observedInit?.cache, "no-store");
  assert.equal((observedInit as RequestInit & { next?: unknown } | undefined)?.next, undefined);
});

test("secondary sync rejects an HTML login page disguised as HTTP 200", async () => {
  const fakeFetch = async () => new Response("<html>login</html>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });

  const result = await runIndependentSyncJobs(
    ["feedbacks"],
    "https://example.test",
    {},
    fakeFetch as typeof fetch,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.results.feedbacks, {
    error: "Некорректный JSON-ответ дочерней синхронизации",
    status: 200,
  });
});

test("secondary sync rejects an empty JSON object disguised as success", async () => {
  const fakeFetch = async () => Response.json({});
  const result = await runIndependentSyncJobs(
    ["commissions"],
    "https://example.test",
    {},
    fakeFetch as typeof fetch,
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.results.commissions, {
    error: "Дочерняя синхронизация не подтвердила успех",
    status: 200,
  });
});
