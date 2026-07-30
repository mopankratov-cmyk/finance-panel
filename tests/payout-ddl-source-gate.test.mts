import assert from "node:assert/strict";
import test from "node:test";

import { runSourceGate } from "../test/payout-ddl/run.mjs";

test("payout DDL source gate covers the exact Supabase PG17 role edge", async () => {
  const result = await runSourceGate();

  assert.equal(result.mode, "SOURCE_ONLY");
  assert.equal(result.registryTotal, 349);
  assert.equal(
    result.migration.hostedPg17RoleEdges,
    "zero-or-exact-admin-only-pair",
  );
  assert.equal(result.dbConnections, 0);
  assert.equal(result.networkCalls, 0);
});
