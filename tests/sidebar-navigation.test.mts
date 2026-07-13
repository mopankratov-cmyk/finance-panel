import assert from "node:assert/strict";
import test from "node:test";
import { isFinanceSidebarPath } from "../lib/navigation/sidebar";

test("finance pages use the finance-only sidebar", () => {
  for (const path of ["/summary", "/pnl", "/losses", "/opiu", "/calendar", "/payments", "/accounts", "/loans", "/costs"]) {
    assert.equal(isFinanceSidebarPath(path), true, path);
  }
  assert.equal(isFinanceSidebarPath("/pnl/details"), true);
});

test("marketplace and system pages keep the general sidebar", () => {
  for (const path of ["/", "/wb/rnp", "/ozon", "/cabinets", "/users", "/sync"]) {
    assert.equal(isFinanceSidebarPath(path), false, path);
  }
});
