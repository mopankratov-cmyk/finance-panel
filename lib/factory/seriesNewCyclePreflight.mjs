#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://finance-panel-two.vercel.app";
const DEFAULT_JSON_OUT = "docs/factory-latest-series-new-cycle-preflight.json";
const DEFAULT_MD_OUT = "docs/factory-latest-series-new-cycle-preflight.md";

function readFlag(args, index) {
  const arg = args[index];
  const eq = arg.indexOf("=");
  if (eq !== -1) return { value: arg.slice(eq + 1), next: index + 1 };
  return { value: args[index + 1], next: index + 2 };
}

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.BASE_URL || process.env.FACTORY_SERIES_BASE_URL || DEFAULT_BASE_URL,
    secret: process.env.CRON_SECRET || "",
    niche: process.env.FACTORY_SERIES_NICHE || "",
    seriesAfter: process.env.FACTORY_SERIES_AFTER || new Date().toISOString(),
    count: Number(process.env.FACTORY_SERIES_BATCH_SIZE || 5),
    budgetUsd: Number(process.env.FACTORY_SERIES_BUDGET_USD || 40),
    timeoutMs: Number(process.env.FACTORY_SERIES_TIMEOUT_MS || 45_000),
    jsonOut: process.env.FACTORY_SERIES_PREFLIGHT_JSON_OUT || DEFAULT_JSON_OUT,
    mdOut: process.env.FACTORY_SERIES_PREFLIGHT_MD_OUT || DEFAULT_MD_OUT,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length;) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { opts.help = true; i += 1; continue; }
    if (arg === "--json") { opts.json = true; i += 1; continue; }
    if (arg.startsWith("--base-url")) { const r = readFlag(argv, i); opts.baseUrl = String(r.value || opts.baseUrl); i = r.next; continue; }
    if (arg.startsWith("--secret")) { const r = readFlag(argv, i); opts.secret = String(r.value || ""); i = r.next; continue; }
    if (arg.startsWith("--niche")) { const r = readFlag(argv, i); opts.niche = String(r.value || ""); i = r.next; continue; }
    if (arg.startsWith("--series-after")) { const r = readFlag(argv, i); opts.seriesAfter = String(r.value || opts.seriesAfter); i = r.next; continue; }
    if (arg.startsWith("--count")) { const r = readFlag(argv, i); opts.count = Number(r.value) || opts.count; i = r.next; continue; }
    if (arg.startsWith("--budget-usd")) { const r = readFlag(argv, i); opts.budgetUsd = Number(r.value) || opts.budgetUsd; i = r.next; continue; }
    if (arg.startsWith("--timeout-ms")) { const r = readFlag(argv, i); opts.timeoutMs = Number(r.value) || opts.timeoutMs; i = r.next; continue; }
    if (arg.startsWith("--json-out")) { const r = readFlag(argv, i); opts.jsonOut = String(r.value || ""); i = r.next; continue; }
    if (arg.startsWith("--md-out")) { const r = readFlag(argv, i); opts.mdOut = String(r.value || ""); i = r.next; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  opts.baseUrl = String(opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  opts.count = Math.max(2, Math.min(10, Math.round(opts.count || 5)));
  opts.budgetUsd = Math.max(1, Math.round((opts.budgetUsd || 40) * 100) / 100);
  opts.timeoutMs = Math.max(5_000, Math.round(opts.timeoutMs || 45_000));
  return opts;
}

function usage() {
  return `
Factory new-cycle preflight (no generation launch).

Usage:
  CRON_SECRET=... node lib/factory/seriesNewCyclePreflight.mjs --niche cosmetics

Options:
  --base-url <url>       Default: ${DEFAULT_BASE_URL}
  --secret <token>       Optional bearer token / CRON_SECRET
  --niche <name>         Optional niche filter
  --series-after <iso>   Default: now
  --count <n>            Default: 5
  --budget-usd <n>       Default: 40
  --timeout-ms <n>       Default: 45000
  --json-out <path>      Default: ${DEFAULT_JSON_OUT}
  --md-out <path>        Default: ${DEFAULT_MD_OUT}
  --json                 Print JSON payload

This script only calls readiness GET and /batch dry_run:true.
`.trim();
}

function headers(secret, json = false) {
  const h = { Accept: "application/json" };
  if (json) h["Content-Type"] = "application/json";
  if (secret) h.Authorization = `Bearer ${secret}`;
  return h;
}

async function writeMaybe(filePath, content) {
  if (!filePath) return;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function requestJson(url, init, timeoutMs) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { ok: false, raw: text.slice(0, 500) }; }
  return { status: res.status, ok: res.ok, body };
}

async function fetchReadiness(opts) {
  const url = new URL(`${opts.baseUrl}/api/factory/series-readiness`);
  if (opts.niche) url.searchParams.set("niche", opts.niche);
  url.searchParams.set("series_after", opts.seriesAfter);
  url.searchParams.set("target_runs", "50");
  url.searchParams.set("batch_size", String(opts.count));
  return await requestJson(url, { method: "GET", headers: headers(opts.secret) }, opts.timeoutMs);
}

async function dryRunBatch(opts) {
  return await requestJson(`${opts.baseUrl}/api/factory/batch`, {
    method: "POST",
    headers: headers(opts.secret, true),
    body: JSON.stringify({
      niche: opts.niche || null,
      count: opts.count,
      budget_usd: opts.budgetUsd,
      dry_run: true,
      require_full_batch: true,
      require_learning_gate: true,
      series_after: opts.seriesAfter,
    }),
  }, opts.timeoutMs);
}

function buildMarkdown(payload) {
  const readiness = payload.readiness?.body || {};
  const batch = payload.batch?.body || {};
  const preflight = batch.preflight || {};
  const gate = batch.learning_gate || readiness.next_batch_gate || {};
  const lines = [
    "# Factory New-Cycle Preflight",
    "",
    `- generated_at: ${payload.generated_at}`,
    `- base_url: ${payload.base_url}`,
    `- niche: ${payload.niche || ""}`,
    `- series_after: ${payload.series_after}`,
    `- ok: ${payload.ok ? "yes" : "no"}`,
    `- readiness_status: ${payload.readiness?.status ?? ""}`,
    `- readiness: ${readiness.ready_to_launch_next ? "ready" : "hold"}`,
    `- blockers: ${Array.isArray(readiness.blockers) && readiness.blockers.length ? readiness.blockers.join(" | ") : "none"}`,
    `- batch_status: ${payload.batch?.status ?? ""}`,
    `- dry_run: ${batch.dry_run === true ? "yes" : "no"}`,
    `- selected: ${Array.isArray(batch.selected_recipes) ? batch.selected_recipes.length : 0}/${payload.count}`,
    `- preflight_ready: ${preflight.ready ? "yes" : "no"}`,
    `- learning_gate: ${gate.ready ? "ready" : "hold"} · ${gate.reason || ""}`,
    `- estimated_usd: ${batch.estimated_usd ?? ""}`,
    `- worst_case_usd: ${batch.worst_case_usd ?? ""}`,
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }
  const readiness = await fetchReadiness(opts);
  const batch = await dryRunBatch(opts);
  const ok = readiness.ok && readiness.body?.ok === true && batch.ok && batch.body?.ok === true && batch.body?.dry_run === true && batch.body?.preflight?.ready === true;
  const payload = {
    generated_at: new Date().toISOString(),
    base_url: opts.baseUrl,
    niche: opts.niche || null,
    series_after: opts.seriesAfter,
    count: opts.count,
    budget_usd: opts.budgetUsd,
    ok,
    readiness,
    batch,
  };
  await writeMaybe(opts.jsonOut, JSON.stringify(payload, null, 2) + "\n");
  await writeMaybe(opts.mdOut, buildMarkdown(payload));
  if (opts.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(`${ok ? "ready" : "hold"} · series_after ${opts.seriesAfter} · selected ${Array.isArray(batch.body?.selected_recipes) ? batch.body.selected_recipes.length : 0}/${opts.count}`);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`series new-cycle preflight failed: ${String(err?.message || err).slice(0, 240)}`);
  process.exitCode = 1;
});
