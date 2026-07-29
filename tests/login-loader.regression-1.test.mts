import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { needsFinanceHydration } from "../lib/navigation/financeHydration";

test("login redirect to launcher does not wait for legacy finance hydration", () => {
  assert.equal(needsFinanceHydration("/"), false);
  assert.equal(needsFinanceHydration("/wb/rnp"), false);
  assert.equal(needsFinanceHydration("/ozon/adverts"), false);
  assert.equal(needsFinanceHydration("/sync"), false);

  assert.equal(needsFinanceHydration("/calendar"), true);
  assert.equal(needsFinanceHydration("/payments"), true);
  assert.equal(needsFinanceHydration("/accounts"), true);
  assert.equal(needsFinanceHydration("/loans"), true);
});

test("AppLayout gates the loader and load error only on finance-backed pages", () => {
  const source = readFileSync(new URL("../components/AppLayout.tsx", import.meta.url), "utf8");

  assert.match(source, /const requiresFinanceHydration = needsFinanceHydration\(pathname\)/);
  assert.match(source, /if \(requiresFinanceHydration && !hydrated\)/);
  assert.match(source, /if \(requiresFinanceHydration && loadError\)/);
});

test("FinanceProvider has a client-side timeout instead of an endless spinner", () => {
  const source = readFileSync(new URL("../components/providers/FinanceProvider.tsx", import.meta.url), "utf8");

  assert.match(source, /FINANCE_LOAD_TIMEOUT_MS = 12_000/);
  assert.match(source, /withTimeout\(loadFinanceState\(\), FINANCE_LOAD_TIMEOUT_MS\)/);
});
