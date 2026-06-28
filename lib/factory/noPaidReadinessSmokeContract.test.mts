import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";

const source = readFileSync("lib/factory/noPaidReadinessSmoke.mjs", "utf8");

ok(/Factory no-paid readiness smoke/.test(source), "no-paid smoke documents its purpose");
ok(/DEFAULT_JSON_OUT = "docs\/factory-latest-no-paid-smoke\.json"/.test(source), "no-paid smoke writes latest JSON artifact");
ok(/DEFAULT_MD_OUT = "docs\/factory-latest-no-paid-smoke\.md"/.test(source), "no-paid smoke writes latest markdown artifact");
ok(/\/api\/factory\/quality-diagnostics/.test(source), "no-paid smoke calls quality diagnostics");
ok(/\/api\/factory\/memory-quality/.test(source), "no-paid smoke calls memory quality");
ok(/\/api\/factory\/feedback-queue/.test(source), "no-paid smoke surfaces operator feedback queue");
ok(/\/api\/factory\/feedback-queue\/auto/.test(source) && /apply: false/.test(source), "no-paid smoke dry-runs automatic feedback without writes");
ok(/\/api\/factory\/batch/.test(source) && /dry_run: true/.test(source), "no-paid smoke only dry-runs batch");
ok(/skip_balance_check: true/.test(source), "no-paid smoke can inspect source quality even when paid balance is low");
ok(/require_strong_source: true/.test(source), "no-paid smoke checks quality-first strong source gate");
ok(!/\/api\/factory\/graph-run"/.test(source), "no-paid smoke never starts graph-run");
ok(!/\/api\/factory\/prepare-product/.test(source), "no-paid smoke never calls source-prep/FAL");
ok(/ready_for_paid_batch/.test(source), "no-paid smoke summarizes paid launch readiness");

console.log("noPaidReadinessSmokeContract: passed");
