import assert from "node:assert/strict";
import test from "node:test";

import {
  itemSubject,
  MpstatsApiError,
  mpstatsRouteError,
} from "../lib/mpstats/client";

test("MPSTATS 401 is surfaced as an authentication error instead of empty data", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.MPSTATS_TOKEN;
  process.env.MPSTATS_TOKEN = "invalid-test-token";
  globalThis.fetch = async () => new Response(
    JSON.stringify({ code: 401, message: "Authorization Required" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );

  try {
    await assert.rejects(
      () => itemSubject(123),
      (error: unknown) => error instanceof MpstatsApiError
        && error.code === "auth"
        && error.upstreamStatus === 401,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.MPSTATS_TOKEN;
    else process.env.MPSTATS_TOKEN = originalToken;
  }
});

test("MPSTATS auth failures map to a clear provider error", () => {
  const failure = mpstatsRouteError(new MpstatsApiError("auth", "auth", 401));
  assert.deepEqual(failure, {
    status: 502,
    message: "MPSTATS: токен недействителен или истёк",
  });
});
