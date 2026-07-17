import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fetchWbFeedbacksPage, WbFeedbacksCursorError } from "../lib/wb/feedbacksApi";

test("WB feedbacks 422 on a saved skip is classified as a stale cursor", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () => new Response(
    '{"data":null,"error":true,"errorText":"Не удалось получить отзывы по skip"}',
    { status: 422 },
  )) as typeof fetch;

  await assert.rejects(
    () => fetchWbFeedbacksPage("test-token", false, 5_000, 5_000),
    (error) => {
      assert.ok(error instanceof WbFeedbacksCursorError);
      assert.equal(error.status, 422);
      assert.match(error.message, /WB 422/);
      return true;
    },
  );
});

test("scoped feedback pages ask WB for one nmId and the bounded date window", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let requested = "";
  globalThis.fetch = (async (input) => {
    requested = String(input);
    return Response.json({ data: { feedbacks: [] } });
  }) as typeof fetch;

  await fetchWbFeedbacksPage("test-token", true, 0, 5_000, {
    nmId: 123456,
    dateFrom: 1_700_000_000,
    dateTo: 1_700_086_400,
  });

  const url = new URL(requested);
  assert.equal(url.searchParams.get("nmId"), "123456");
  assert.equal(url.searchParams.get("dateFrom"), "1700000000");
  assert.equal(url.searchParams.get("dateTo"), "1700086400");
  assert.equal(url.searchParams.get("isAnswered"), "true");
});

test("feedbacks sync route resets a stale WB feedback cursor before failing red", () => {
  const source = readFileSync(new URL("../app/api/sync/feedbacks/route.ts", import.meta.url), "utf8");

  assert.match(source, /instanceof WbFeedbacksCursorError/);
  assert.match(source, /unansweredSkip = 0/);
  assert.match(source, /answeredSkip = 0/);
  assert.match(source, /cursorResets/);
  assert.match(source, /export const maxDuration = 300/);
  assert.match(source, /MAX_PAGES_PER_RUN = 30/);
  assert.match(source, /orderedCabs/);
  assert.match(source, /productScope\.allowedNmIds !== null/);
  assert.match(source, /dateFrom: Math\.floor\(cutoff \/ 1_000\)/);
  assert.match(source, /status: completed \? "caught_up" : "pending"/);
});
