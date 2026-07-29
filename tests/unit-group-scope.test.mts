import assert from "node:assert/strict";
import test from "node:test";
import {
  UnitScopeError,
  assertUnitScopeAccess,
  canonicalGroupScopeKey,
  parseUnitCabinetQuery,
  resolveUnitCabinetScope,
} from "../lib/unit/groupScope";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

test("cabinet is a singleton and duplicates fail before resolution", async () => {
  const sp = new URLSearchParams(`cabinet=all&cabinet=${A}`);
  assert.throws(() => parseUnitCabinetQuery(sp), UnitScopeError);
  let queried = false;
  try {
    const raw = parseUnitCabinetQuery(sp);
    await resolveUnitCabinetScope(raw, {
      group: async () => { queried = true; return { data: null, error: null }; },
      cabinets: async () => { queried = true; return { data: [], error: null }; },
    });
  } catch {}
  assert.equal(queried, false);
});

test("single scope is exact active WB with lookup errors separated", async () => {
  let missing: unknown;
  try {
    await resolveUnitCabinetScope(A, {
      group: async () => ({ data: null, error: null }),
      cabinets: async () => ({ data: [], error: null }),
    });
  } catch (error) { missing = error; }
  assert.ok(missing instanceof UnitScopeError);
  assert.equal((missing as UnitScopeError).status, 404);

  let failed: unknown;
  try {
    await resolveUnitCabinetScope(A, {
      group: async () => ({ data: null, error: null }),
      cabinets: async () => ({ data: null, error: new Error("secret db detail") }),
    });
  } catch (error) { failed = error; }
  assert.ok(failed instanceof UnitScopeError);
  assert.equal((failed as UnitScopeError).status, 503);
  assert.doesNotMatch((failed as UnitScopeError).message, /secret/);
});

test("group canonicalizes UUID members and stale member fails the whole scope", async () => {
  const resolved = await resolveUnitCabinetScope("group:7", {
    group: async () => ({ data: { id: 7, marketplace: "wb", member_ids: [B, A, B] }, error: null }),
    cabinets: async () => ({
      data: [
        { id: B, marketplace: "wb", is_active: true },
        { id: A, marketplace: "wb", is_active: true },
      ],
      error: null,
    }),
  });
  assert.deepEqual(resolved, { mode: "group", members: [A, B], scopeKey: canonicalGroupScopeKey([A, B]) });

  let stale: unknown;
  try {
    await resolveUnitCabinetScope("group:7", {
      group: async () => ({ data: { id: 7, marketplace: "wb", member_ids: [A, C] }, error: null }),
      cabinets: async () => ({ data: [{ id: A, marketplace: "wb", is_active: true }], error: null }),
    });
  } catch (error) { stale = error; }
  assert.ok(stale instanceof UnitScopeError);
  assert.equal((stale as UnitScopeError).status, 409);
});

test("malformed/missing/foreign group fails visibly", async () => {
  for (const raw of ["group:0", "group:-1", "group:nope", "group:999999999999999999999"]) {
    assert.throws(() => parseUnitCabinetQuery(new URLSearchParams(`cabinet=${raw}`)), UnitScopeError);
  }
  for (const row of [null, { id: 8, marketplace: "ozon", member_ids: [A] }]) {
    let caught: unknown;
    try {
      await resolveUnitCabinetScope("group:8", {
        group: async () => ({ data: row, error: null }),
        cabinets: async () => ({ data: [], error: null }),
      });
    } catch (error) { caught = error; }
    assert.ok(caught instanceof UnitScopeError);
    assert.equal(caught.status, 404);
  }
});

test("restricted manager needs every member and cannot request all", () => {
  const manager = { role: "manager" as const, cabinet_ids: [A] };
  assert.throws(() => assertUnitScopeAccess(manager, { mode: "all", scopeKey: "all" }), UnitScopeError);
  assert.throws(
    () => assertUnitScopeAccess(manager, { mode: "group", members: [A, B], scopeKey: canonicalGroupScopeKey([A, B]) }),
    UnitScopeError,
  );
  assert.doesNotThrow(
    () => assertUnitScopeAccess({ ...manager, cabinet_ids: [B, A] }, {
      mode: "group", members: [A, B], scopeKey: canonicalGroupScopeKey([B, A]),
    }),
  );
});

test("cache identity follows canonical membership, not group id or order", () => {
  assert.equal(canonicalGroupScopeKey([B, A, B]), canonicalGroupScopeKey([A, B]));
  assert.equal(canonicalGroupScopeKey([A.toUpperCase(), B]), canonicalGroupScopeKey([A, B]));
  assert.notEqual(canonicalGroupScopeKey([A, B]), canonicalGroupScopeKey([A, C]));
  assert.doesNotMatch(canonicalGroupScopeKey([A, B]), new RegExp(A));
  assert.match(canonicalGroupScopeKey([A, B]), /^group:v2:[0-9a-f]{64}$/);
});

test("oversized groups fail before cabinet diagnostics", async () => {
  let cabinetsQueried = false;
  await assert.rejects(
    resolveUnitCabinetScope("group:9", {
      group: async () => ({
        data: {
          id: 9,
          marketplace: "wb",
          member_ids: [A, B, C, "00000000-0000-4000-8000-00000000000d"],
        },
        error: null,
      }),
      cabinets: async () => {
        cabinetsQueried = true;
        return { data: [], error: null };
      },
    }),
    (error: unknown) => error instanceof UnitScopeError && error.status === 422,
  );
  assert.equal(cabinetsQueried, false);
});

test("manager member ACL runs before active-member diagnostics", async () => {
  const calls: string[] = [];
  await assert.rejects(
    resolveUnitCabinetScope("group:7", {
      group: async () => ({ data: { id: 7, marketplace: "wb", member_ids: [A, B] }, error: null }),
      authorizeMembers: (members) => {
        calls.push("acl");
        assertUnitScopeAccess(
          { role: "manager", cabinet_ids: [A] },
          { mode: "group", members, scopeKey: canonicalGroupScopeKey(members) },
        );
      },
      cabinets: async () => {
        calls.push("active");
        return { data: [], error: null };
      },
    }),
    (error: unknown) => error instanceof UnitScopeError && error.status === 403,
  );
  assert.deepEqual(calls, ["acl"]);
});

test("UUID scope is canonical lowercase for lookup, access and cache", async () => {
  const raw = parseUnitCabinetQuery(new URLSearchParams(`cabinet=${A.toUpperCase()}`));
  assert.equal(raw, A);
  const scope = await resolveUnitCabinetScope(raw, {
    group: async () => ({ data: null, error: null }),
    cabinets: async (ids) => ({
      data: [{ id: A, marketplace: "wb", is_active: true }],
      error: ids[0] === A ? null : new Error("non-canonical lookup"),
    }),
  });
  assert.deepEqual(scope, { mode: "single", cabinetId: A, scopeKey: `single:${A}` });
  assert.doesNotThrow(() => assertUnitScopeAccess(
    { role: "manager", cabinet_ids: [A.toUpperCase()] },
    scope,
  ));
});
