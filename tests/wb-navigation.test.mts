import assert from "node:assert/strict";
import test from "node:test";
import { WB_MOBILE_NAVIGATION, WB_NAVIGATION_ITEMS, isWbNavigationItemActive } from "../lib/wb/navigation";

test("WB navigation exposes only the approved dashboards as direct links", () => {
  assert.deepEqual(WB_NAVIGATION_ITEMS.map((item) => item.href), [
    "/wb/rnp",
    "/wb/planning",
    "/wb/funnel",
    "/wb/adverts",
    "/wb/supplies",
    "/wb/unit",
    "/wb/product",
    "/wb/seo",
    "/wb/sklejki",
    "/wb/reviews",
    "/wb/ctr",
    "/wb/shelf",
    "/wb/market",
  ]);
  assert.equal(new Set(WB_NAVIGATION_ITEMS.map((item) => item.href)).size, WB_NAVIGATION_ITEMS.length);
});

test("WB mobile navigation keeps four operational shortcuts", () => {
  assert.deepEqual(WB_MOBILE_NAVIGATION.map((item) => item.href), [
    "/wb/rnp",
    "/wb/planning",
    "/wb/adverts",
    "/wb/supplies",
  ]);
});

test("WB route activity handles nested pages without a separate home item", () => {
  assert.equal(WB_NAVIGATION_ITEMS.some((item) => item.href === "/wb"), false);
  assert.equal(isWbNavigationItemActive("/wb/rnp", "/wb/rnp"), true);
  assert.equal(isWbNavigationItemActive("/wb/ctr/session", "/wb/ctr"), true);
  assert.equal(isWbNavigationItemActive("/wb/adverts", "/wb/rnp"), false);
});
