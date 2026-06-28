import { test } from "node:test";
import assert from "node:assert/strict";
import { reelsBrainEnvStatus } from "./reelsBrainEnv";

test("reelsBrainEnvStatus reports missing Supabase pieces without exposing values", () => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldCron = process.env.CRON_SECRET;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.CRON_SECRET = "secret-value";

  try {
    const status = reelsBrainEnvStatus();
    assert.equal(status.supabase.configured, false);
    assert.equal(status.supabase.url, false);
    assert.equal(status.supabase.service_role, false);
    assert.deepEqual(status.supabase.missing, ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
    assert.equal(status.cron_secret, true);
    assert.equal(JSON.stringify(status).includes("secret-value"), false);
  } finally {
    if (oldUrl == null) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl;
    if (oldKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    if (oldCron == null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = oldCron;
  }
});
