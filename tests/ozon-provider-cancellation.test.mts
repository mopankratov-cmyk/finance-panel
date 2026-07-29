import assert from "node:assert/strict";
import test from "node:test";
import { ozonAnalyticsDaily, ozonPrices } from "../lib/ozon/api";
import { loadPlanningState } from "../lib/planning/stateStore";
import { applyOzonQuerySignal } from "../lib/ozon/cabinet";

const creds = { clientId: "client", apiKey: "secret" };

function abortableBodyResponse(
  controller: AbortController,
  onBodyStarted?: () => void,
) {
  return {
    ok: true,
    status: 200,
    json() {
      return new Promise((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        onBodyStarted?.();
      });
    },
  } as Response;
}

test("price abort during first response body starts only one fetch", async () => {
  const controller = new AbortController();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return abortableBodyResponse(controller, () => controller.abort());
  }) as typeof fetch;
  try {
    const result = await ozonPrices(creds, { signal: controller.signal });
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analytics abort during first response body starts no fallback or next page", async () => {
  const controller = new AbortController();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return abortableBodyResponse(controller, () => controller.abort());
  }) as typeof fetch;
  try {
    const result = await ozonAnalyticsDaily(
      creds,
      "2026-07-01",
      "2026-07-31",
      true,
      { signal: controller.signal },
    );
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("already-aborted provider signals start zero fetches", async () => {
  const controller = new AbortController();
  controller.abort("sensitive-abort-reason");
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("must not fetch");
  }) as typeof fetch;
  try {
    const prices = await ozonPrices(creds, { signal: controller.signal });
    assert.equal(prices.ok, false);
    if (!prices.ok) assert.doesNotMatch(prices.error, /sensitive-abort-reason/);
    const analytics = await ozonAnalyticsDaily(
        creds,
        "2026-07-01",
        "2026-07-31",
        false,
        { signal: controller.signal },
      );
    assert.equal(analytics.ok, false);
    if (!analytics.ok) {
      assert.doesNotMatch(analytics.error, /sensitive-abort-reason/);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("existing no-options provider signatures remain callable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    return {
      ok: true,
      status: 200,
      json: async () => url.includes("/prices")
        ? { items: [], cursor: "" }
        : { result: { data: [] } },
    } as Response;
  }) as typeof fetch;
  try {
    assert.equal((await ozonPrices(creds)).ok, true);
    assert.equal(
      (await ozonAnalyticsDaily(creds, "2026-07-01", "2026-07-31")).ok,
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("financial caller cache policy is no-store without revalidation", async () => {
  const inits: RequestInit[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    inits.push(init ?? {});
    return {
      ok: true,
      status: 200,
      json: async () => ({ items: [], cursor: "", result: { data: [] } }),
    } as Response;
  }) as typeof fetch;
  try {
    await ozonPrices(creds, { cache: "no-store" });
    await ozonAnalyticsDaily(
      creds,
      "2026-07-01",
      "2026-07-31",
      false,
      { cache: "no-store" },
    );
    assert.equal(inits.length, 2);
    for (const init of inits) {
      assert.equal(init.cache, "no-store");
      assert.equal(init.next, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("planning state propagates the signal through the fluent query", async () => {
  const controller = new AbortController();
  const observed: AbortSignal[] = [];
  const result = { data: { data: { ok: true }, updated_at: "2026-07-28" }, error: null };
  const query = {
    select() { return query; },
    eq() { return query; },
    abortSignal(signal: AbortSignal) { observed.push(signal); return query; },
    maybeSingle() { return Promise.resolve(result); },
  };
  const db = { from() { return query; } };

  const snapshot = await loadPlanningState(
    db as never,
    2026,
    { signal: controller.signal },
  );

  assert.deepEqual(snapshot.data, { ok: true });
  assert.deepEqual(observed, [controller.signal]);
});

test("cabinet fluent queries receive the caller signal and pre-abort starts nothing", () => {
  const controller = new AbortController();
  const observed: AbortSignal[] = [];
  const query = {
    abortSignal(signal: AbortSignal) {
      observed.push(signal);
      return query;
    },
  };
  assert.equal(applyOzonQuerySignal(query, controller.signal), query);
  assert.deepEqual(observed, [controller.signal]);

  controller.abort();
  assert.throws(() => applyOzonQuerySignal(query, controller.signal), /abort/i);
  assert.equal(observed.length, 1);
});
