import assert from "node:assert/strict";
import test from "node:test";
import { loadUnitProductScope } from "../lib/unit/productScope";

test("group product scope query errors are fail-visible", async () => {
  await assert.rejects(loadUnitProductScope("cab-a", {
    cabinet: async () => ({ data: null, error: { message: "cabinet scope failed" } }),
    scopeRows: async () => [],
  }), /cabinet scope failed/);

  await assert.rejects(loadUnitProductScope("cab-a", {
    cabinet: async () => ({
      data: { name: "Optima", trade_mark: null, brand_filters: ["norvia"] },
      error: null,
    }),
    scopeRows: async () => { throw new Error("allowlist query failed"); },
  }), /allowlist query failed/);
});

test("group product scope distinguishes unrestricted and restricted empty", async () => {
  const unrestricted = await loadUnitProductScope("cab-a", {
    cabinet: async () => ({
      data: { name: "Regular", trade_mark: null, brand_filters: [] },
      error: null,
    }),
    scopeRows: async () => { throw new Error("must not query"); },
  });
  assert.equal(unrestricted, null);

  const restricted = await loadUnitProductScope("cab-b", {
    cabinet: async () => ({
      data: { name: "Optima", trade_mark: null, brand_filters: null },
      error: null,
    }),
    scopeRows: async () => [],
  });
  assert.deepEqual(restricted, new Set());
});

test("group product scope canonicalizes valid nm ids", async () => {
  const scope = await loadUnitProductScope("cab-a", {
    cabinet: async () => ({
      data: { name: "Optima", trade_mark: null, brand_filters: ["norvia"] },
      error: null,
    }),
    scopeRows: async () => [{ nm_id: 2 }, { nm_id: 1 }, { nm_id: 2 }, { nm_id: "bad" }],
  });
  assert.deepEqual(scope, new Set([1, 2]));
});
