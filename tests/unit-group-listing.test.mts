import assert from "node:assert/strict";
import test from "node:test";
import { filterCabinetGroups, shouldShowCabinetSwitcher } from "../lib/unit/groupListing";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const rows = [
  { id: 1, name: "mine", marketplace: "wb", member_ids: [A] },
  { id: 2, name: "partial-secret", marketplace: "wb", member_ids: [A, B] },
];

test("manager listing only returns fully-covered groups without leaking partial names or members", () => {
  const groups = filterCabinetGroups(rows, { role: "manager", cabinet_ids: [A] });
  assert.deepEqual(groups, [{ id: 1, name: "mine", marketplace: "wb", memberIds: [A] }]);
  assert.doesNotMatch(JSON.stringify(groups), /partial-secret/);
  assert.doesNotMatch(JSON.stringify(groups), new RegExp(B));
});

test("director and finance preserve the complete safe group list", () => {
  for (const role of ["director", "finance"] as const) {
    assert.equal(filterCabinetGroups(rows, { role, cabinet_ids: [] }).length, 2);
  }
});

test("the switcher stays visible for any accessible cabinet or group", () => {
  assert.equal(shouldShowCabinetSwitcher(0, 0), false);
  assert.equal(shouldShowCabinetSwitcher(1, 0), true);
  assert.equal(shouldShowCabinetSwitcher(0, 1), true);
  assert.equal(shouldShowCabinetSwitcher(1, 1), true);
  assert.equal(shouldShowCabinetSwitcher(2, 0), true);
});
