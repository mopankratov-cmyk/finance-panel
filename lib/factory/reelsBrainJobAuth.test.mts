import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { isAuthorizedReelsBrainJobRequest } from "./reelsBrainJobAuth";
import { SESSION_COOKIE, signSession } from "@/lib/auth/session";

function buildRequest(input: string, init?: ConstructorParameters<typeof Request>[1]): NextRequest {
  return new NextRequest(new Request(input, init));
}

test("reels brain job auth allows bearer token", async () => {
  process.env.CRON_SECRET = "test-secret";
  const req = buildRequest("https://example.com/api/factory/jobs/reels-brain-learning", {
    headers: { authorization: "Bearer test-secret" },
  });
  assert.equal(await isAuthorizedReelsBrainJobRequest(req), true);
});

test("reels brain job auth allows valid session cookie", async () => {
  process.env.CRON_SECRET = "test-secret";
  const token = await signSession({
    uid: "1",
    email: "owner@example.com",
    role: "director",
    cabinet_ids: [],
  });
  const req = buildRequest("https://example.com/api/factory/jobs/reels-brain-learning", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  assert.equal(await isAuthorizedReelsBrainJobRequest(req), true);
});

test("reels brain job auth rejects invalid request when cron secret is configured", async () => {
  process.env.CRON_SECRET = "test-secret";
  const req = buildRequest("https://example.com/api/factory/jobs/reels-brain-learning");
  assert.equal(await isAuthorizedReelsBrainJobRequest(req), false);
});
