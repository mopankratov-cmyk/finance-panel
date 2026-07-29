import assert from "node:assert/strict";
import test from "node:test";
import { wbRetiredRouteDestination } from "../lib/wb/retiredRoutes";

// Regression test for QA ISSUE-007: retired modules must not remain reachable by URL.
test("removed WB modules lead back to the active RNP screen", () => {
  for (const route of ["/wb/abc", "/wb/planning", "/wb/health", "/wb/tasks"] as const) {
    assert.equal(wbRetiredRouteDestination(route), "/wb/rnp", route);
  }
  assert.equal(wbRetiredRouteDestination("/abc"), "/wb/rnp");
  assert.equal(wbRetiredRouteDestination("/planning"), "/wb/rnp");
});

test("the retired Dynamics route leads to the retained Market dashboard", () => {
  assert.equal(wbRetiredRouteDestination("/wb/trends"), "/wb/market");
  assert.equal(wbRetiredRouteDestination("/trends"), "/wb/market");
});
