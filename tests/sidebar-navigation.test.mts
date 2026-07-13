import assert from "node:assert/strict";
import test from "node:test";
import { isFinanceSidebarPath, isSystemSidebarPath } from "../lib/navigation/sidebar";

test("finance pages use the finance-only sidebar", () => {
  for (const path of ["/summary", "/pnl", "/losses", "/opiu", "/calendar", "/payments", "/accounts", "/loans", "/costs"]) {
    assert.equal(isFinanceSidebarPath(path), true, path);
  }
  assert.equal(isFinanceSidebarPath("/pnl/details"), true);
});

test("marketplace and system pages do not use the finance sidebar", () => {
  for (const path of ["/", "/wb/rnp", "/ozon", "/cabinets", "/users", "/sync"]) {
    assert.equal(isFinanceSidebarPath(path), false, path);
  }
});

test("cabinet administration pages use the system-only sidebar", () => {
  for (const path of ["/cabinets", "/users", "/sync", "/cabinets/groups"]) {
    assert.equal(isSystemSidebarPath(path), true, path);
  }

  for (const path of ["/", "/wb/rnp", "/ozon", "/summary", "/agent", "/cabinets-old"]) {
    assert.equal(isSystemSidebarPath(path), false, path);
  }
});
