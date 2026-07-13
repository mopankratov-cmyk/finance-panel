import assert from "node:assert/strict";
import test from "node:test";
import { WB_MOBILE_NAVIGATION, WB_NAVIGATION_SCENARIOS, isWbNavigationItemActive } from "../lib/wb/navigation";

test("WB navigation exposes every dashboard once through five scenarios", () => {
  const items = WB_NAVIGATION_SCENARIOS.flatMap((scenario) => scenario.items);
  assert.equal(WB_NAVIGATION_SCENARIOS.length, 5);
  assert.equal(items.length, 17);
  assert.equal(new Set(items.map((item) => item.href)).size, items.length);
});

test("WB mobile navigation keeps four operational shortcuts", () => {
  assert.deepEqual(WB_MOBILE_NAVIGATION.map((item) => item.href), [
    "/wb/rnp",
    "/wb/adverts",
    "/wb/planning",
    "/wb/supplies",
  ]);
});

test("WB route activity handles the cockpit alias and nested pages", () => {
  assert.equal(isWbNavigationItemActive("/wb", "/wb/rnp"), true);
  assert.equal(isWbNavigationItemActive("/wb/ctr/session", "/wb/ctr"), true);
  assert.equal(isWbNavigationItemActive("/wb/adverts", "/wb/rnp"), false);
});
