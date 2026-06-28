import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/falVideo.ts", "utf8");

ok(/async function fetchFalBilling\(k: string\)/.test(source), "fal billing fetch is reusable per key");
ok(/const billingKey = process\.env\.FAL_BILLING_KEY \|\| "";/.test(source), "falBalance reads billing key explicitly");
ok(/const renderKey = process\.env\.FAL_KEY \|\| "";/.test(source), "falBalance reads render key explicitly");
ok(/renderKey !== billingKey/.test(source), "falBalance can compare billing and render accounts");
ok(/primary\.balance <= 0/.test(source), "falBalance checks render key when billing key reports hard-low");
ok(/renderAccount\.balance > 0/.test(source), "falBalance can accept positive render-key billing result");
ok(/billing_key_balance: primary\.balance/.test(source), "falBalance preserves billing-key balance for diagnostics");

console.log("falBalanceKeyFallbackContract: passed");
