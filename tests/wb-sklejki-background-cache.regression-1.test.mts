import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: ISSUE-003 — Sklejki blocked the user on a cold hourly snapshot refresh.
// Found by /qa on 2026-07-17
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-17.md
test("Sklejki opens with stale-while-revalidate cache and keeps force refresh explicit", async () => {
  const source = await readFile(new URL("../components/wb/WbSklejkiPage.tsx", import.meta.url), "utf8");

  assert.match(source, /background=1/);
  assert.match(source, /refresh=1/);
  assert.match(source, /forceRefreshRef\.current = false/);
});
