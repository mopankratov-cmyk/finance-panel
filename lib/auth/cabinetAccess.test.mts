import assert from "node:assert/strict";
import test from "node:test";
import { sessionHasCabinetAccess } from "./cabinetAccess";
import { canAccess } from "./roles";

test("WB cockpit is available to the existing marketplace roles", () => {
  assert.equal(canAccess("director", "/wb/rnp"), true);
  assert.equal(canAccess("finance", "/wb/rnp"), true);
  assert.equal(canAccess("manager", "/wb/rnp"), true);
});

test("a restricted manager can read one assigned cabinet but not all or another one", () => {
  const manager = { role: "manager" as const, cabinet_ids: ["cabinet-a"] };
  assert.equal(sessionHasCabinetAccess(manager, "cabinet-a"), true);
  assert.equal(sessionHasCabinetAccess(manager, "cabinet-b"), false);
  assert.equal(sessionHasCabinetAccess(manager, null), false);
});

test("directors and unrestricted managers keep aggregate access", () => {
  assert.equal(sessionHasCabinetAccess({ role: "director", cabinet_ids: [] }, null), true);
  assert.equal(sessionHasCabinetAccess({ role: "manager", cabinet_ids: [] }, null), true);
});
