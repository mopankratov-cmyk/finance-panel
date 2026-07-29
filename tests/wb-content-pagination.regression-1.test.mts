import assert from "node:assert/strict";
import test from "node:test";
import { fetchWbCardPages, fetchWbCardsByNmIds } from "../lib/wb/cardPagination";

test("Content API pagination continues beyond the old 30-page ceiling", async () => {
  let calls = 0;
  const result = await fetchWbCardPages<{ nmID: number }>({
    token: "test-token",
    pageSize: 1,
    fetchImpl: async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { settings: { cursor: { nmID?: number } } };
      const previous = body.settings.cursor.nmID ?? 0;
      if (previous >= 31) return Response.json({ cards: [] });
      return Response.json({ cards: [{ nmID: previous + 1 }], cursor: { updatedAt: "2026-07-14T00:00:00Z", nmID: previous + 1 } });
    },
  });

  assert.equal(result.rows.length, 31);
  assert.equal(result.caughtUp, true);
  assert.equal(calls, 32);
});

test("Content API pagination converts plain-text upstream errors into readable errors", async () => {
  await assert.rejects(
    fetchWbCardPages<{ nmID: number }>({
      token: "test-token",
      fetchImpl: async () => new Response("An error occurred with this application.", {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    }),
    /WB Content API вернул не JSON: An error occurred/,
  );
});

test("Content API pagination bounds every upstream page request", async () => {
  let hasTimeoutSignal = false;
  await fetchWbCardPages<{ nmID: number }>({
    token: "test-token",
    requestTimeoutMs: 1234,
    fetchImpl: async (_input, init) => {
      hasTimeoutSignal = init?.signal instanceof AbortSignal;
      return Response.json({ cards: [] });
    },
  });

  assert.equal(hasTimeoutSignal, true);
});

test("scoped Content API lookup searches exact nmIDs without scanning the seller catalog", async () => {
  const requests: Array<{ textSearch?: string; updatedAt?: string }> = [];
  const slept: number[] = [];
  const rows = await fetchWbCardsByNmIds<{ nmID: number }>({
    token: "test-token",
    nmIds: [1244157225, 1244157226, 1244157225],
    minIntervalMs: 600,
    sleep: async (ms) => { slept.push(ms); },
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        settings: { cursor: { updatedAt?: string }; filter: { textSearch?: string } };
      };
      requests.push({
        textSearch: body.settings.filter.textSearch,
        updatedAt: body.settings.cursor.updatedAt,
      });
      const nmID = Number(body.settings.filter.textSearch);
      return Response.json({ cards: [{ nmID }, { nmID: 999 }] });
    },
  });

  assert.deepEqual(rows.map((row) => row.nmID), [1244157225, 1244157226]);
  assert.deepEqual(requests, [
    { textSearch: "1244157225", updatedAt: undefined },
    { textSearch: "1244157226", updatedAt: undefined },
  ]);
  assert.deepEqual(slept, [600]);
});

test("scoped Content API lookup retries a transient missing nmID once", async () => {
  let calls = 0;
  const rows = await fetchWbCardsByNmIds<{ nmID: number }>({
    token: "test-token",
    nmIds: [1244157225],
    minIntervalMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ cards: calls === 1 ? [] : [{ nmID: 1244157225 }] });
    },
  });

  assert.deepEqual(rows, [{ nmID: 1244157225 }]);
  assert.equal(calls, 2);
});

test("scoped Content API lookup preserves nmID order when an earlier card needs a second lookup", async () => {
  const requests: number[] = [];
  const slept: number[] = [];
  const attempts = new Map<number, number>();
  const rows = await fetchWbCardsByNmIds<{ nmID: number }>({
    token: "test-token",
    nmIds: [1, 2],
    minIntervalMs: 600,
    sleep: async (ms) => { slept.push(ms); },
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        settings: { filter: { textSearch: string } };
      };
      const nmID = Number(body.settings.filter.textSearch);
      requests.push(nmID);
      const attempt = (attempts.get(nmID) ?? 0) + 1;
      attempts.set(nmID, attempt);
      return Response.json({ cards: nmID === 1 && attempt === 1 ? [] : [{ nmID }] });
    },
  });

  assert.deepEqual(rows.map((row) => row.nmID), [1, 2]);
  assert.deepEqual(requests, [1, 2, 1]);
  assert.deepEqual(slept, [600, 600]);
});

test("scoped Content API lookup rejects after a persistent missing nmID", async () => {
  let calls = 0;
  await assert.rejects(
    fetchWbCardsByNmIds<{ nmID: number }>({
      token: "test-token",
      nmIds: [1244157225],
      minIntervalMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ cards: [] });
      },
    }),
    /WB Content API.*nmID.*1244157225/,
  );
  assert.equal(calls, 2);
});

test("scoped Content API lookup reports every persistently missing nmID", async () => {
  const requests: number[] = [];
  await assert.rejects(
    fetchWbCardsByNmIds<{ nmID: number }>({
      token: "test-token",
      nmIds: [1, 2, 3],
      minIntervalMs: 0,
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          settings: { filter: { textSearch: string } };
        };
        const nmID = Number(body.settings.filter.textSearch);
        requests.push(nmID);
        return Response.json({ cards: nmID === 2 ? [{ nmID }] : [] });
      },
    }),
    /WB Content API.*nmID: 1, 3/,
  );
  assert.deepEqual(requests, [1, 2, 3, 1, 3]);
});

test("scoped Content API lookup does not semantically retry an exact card found after HTTP 429", async () => {
  const requests: number[] = [];
  const slept: number[] = [];
  const attempts = new Map<number, number>();
  const rows = await fetchWbCardsByNmIds<{ nmID: number }>({
    token: "test-token",
    nmIds: [1, 2],
    minIntervalMs: 600,
    sleep: async (ms) => { slept.push(ms); },
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        settings: { filter: { textSearch: string } };
      };
      const nmID = Number(body.settings.filter.textSearch);
      requests.push(nmID);
      const attempt = (attempts.get(nmID) ?? 0) + 1;
      attempts.set(nmID, attempt);
      if (nmID === 1 && attempt === 1) {
        return new Response("rate limited", { status: 429, headers: { "retry-after": "1" } });
      }
      return Response.json({ cards: [{ nmID }] });
    },
  });

  assert.deepEqual(rows.map((row) => row.nmID), [1, 2]);
  assert.deepEqual(requests, [1, 1, 2]);
  assert.deepEqual(slept, [1_000, 600]);
});
