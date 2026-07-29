import test from "node:test";
import assert from "node:assert/strict";
import { filterRepricerRowsByScopes } from "../lib/repricer/scope";
import { normalizeBrandFilters, type WbProductScope } from "../lib/wb/productScope";

const unrestricted: WbProductScope = { brandFilters: [], allowedNmIds: null };
const optima: WbProductScope = {
  brandFilters: normalizeBrandFilters(["NORVIA", "RIOBOX"]),
  allowedNmIds: [101, 202],
};

test("repricer history re-applies the current Optima allowlist", () => {
  const scopes = new Map<string, WbProductScope>([
    ["optima", optima],
    ["clerin", unrestricted],
  ]);
  const rows = filterRepricerRowsByScopes([
    { cabinet: "optima", nm_id: 101, article: "NORVIA-1" },
    { cabinet: "optima", nm_id: 999, article: "FOREIGN-1" },
    { cabinet: "clerin", nm_id: 999, article: "CLERIN-1" },
  ], scopes);

  assert.deepEqual(rows.map((row) => row.article), ["NORVIA-1", "CLERIN-1"]);
});

test("empty scoped allowlist fails closed while legacy rows stay readable", () => {
  const scopes = new Map<string, WbProductScope>([
    ["optima", { ...optima, allowedNmIds: [] }],
  ]);
  const rows = filterRepricerRowsByScopes([
    { cabinet: "optima", nm_id: 101 },
    { cabinet: "legacy", nm_id: 303 },
  ], scopes);

  assert.deepEqual(rows, [{ cabinet: "legacy", nm_id: 303 }]);
});
