import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: ISSUE-004 — Recharts warned about width(-1)/height(-1) on dashboard charts.
// Found by /qa on 2026-07-17
// Report: .gstack/qa-reports/qa-report-finance-panel-two-vercel-app-2026-07-17.md
test("Ozon overview chart has a stable measured container", async () => {
  const source = await readFile(new URL("../components/ozon/OzonOverviewPage.tsx", import.meta.url), "utf8");

  assert.match(source, /min-h-\[280px\] min-w-0 w-full/);
  assert.match(source, /<ResponsiveContainer width="100%" height=\{280\} minWidth=\{0\}>/);
});

test("WB market chart has a stable measured container", async () => {
  const source = await readFile(new URL("../components/wb/WbMarketPage.tsx", import.meta.url), "utf8");

  assert.match(source, /min-h-\[280px\] min-w-0 w-full/);
  assert.match(source, /<ResponsiveContainer width="100%" height=\{280\} minWidth=\{0\}>/);
});
