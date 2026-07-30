import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: ISSUE-004 — production wb_stocks has no supplier_article column.
// Regression: large RNP contracts must be read through the paged loader, not a direct RPC.
test("finance resolves WB articles through the paged deployed RNP contract", async () => {
  const [finance, opiu] = await Promise.all([
    readFile(new URL("../lib/finance/wbCachedFinance.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/opiu/reportRows.ts", import.meta.url), "utf8"),
  ]);
  assert.match(finance, /loadRnpReportRows/);
  assert.doesNotMatch(finance, /\.rpc\("rnp_report"/);
  assert.doesNotMatch(finance, /from\("wb_stocks"\)[\s\S]{0,200}supplier_article/);

  assert.match(opiu, /\.from\("wb_report_rows"\)/);
  assert.match(opiu, /"sa_name"/);
  assert.doesNotMatch(opiu, /\.rpc\("rnp_report"/);
});
