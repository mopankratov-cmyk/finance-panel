#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://finance-panel-two.vercel.app";
const DEFAULT_JSON_OUT = "docs/factory-latest-series-readiness.json";
const DEFAULT_MD_OUT = "docs/factory-latest-series-readiness.md";

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
    seriesAfter: process.env.FACTORY_SERIES_AFTER || "",
    targetRuns: Number(process.env.FACTORY_SERIES_TARGET_RUNS || 50),
    batchSize: Number(process.env.FACTORY_SERIES_BATCH_SIZE || 5),
    timeoutMs: Number(process.env.FACTORY_SERIES_TIMEOUT_MS || 30_000),
    jsonOut: process.env.FACTORY_SERIES_JSON_OUT || DEFAULT_JSON_OUT,
    mdOut: process.env.FACTORY_SERIES_MD_OUT || DEFAULT_MD_OUT,
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
    if (arg.startsWith("--series-after")) { const r = readFlag(argv, i); opts.seriesAfter = String(r.value || ""); i = r.next; continue; }
    if (arg.startsWith("--target-runs")) { const r = readFlag(argv, i); opts.targetRuns = Number(r.value) || opts.targetRuns; i = r.next; continue; }
    if (arg.startsWith("--batch-size")) { const r = readFlag(argv, i); opts.batchSize = Number(r.value) || opts.batchSize; i = r.next; continue; }
    if (arg.startsWith("--timeout-ms")) { const r = readFlag(argv, i); opts.timeoutMs = Number(r.value) || opts.timeoutMs; i = r.next; continue; }
    if (arg.startsWith("--json-out")) { const r = readFlag(argv, i); opts.jsonOut = String(r.value || ""); i = r.next; continue; }
    if (arg.startsWith("--md-out")) { const r = readFlag(argv, i); opts.mdOut = String(r.value || ""); i = r.next; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  opts.baseUrl = String(opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  opts.targetRuns = Math.max(5, Math.min(200, Math.round(opts.targetRuns || 50)));
  opts.batchSize = Math.max(2, Math.min(10, Math.round(opts.batchSize || 5)));
  opts.timeoutMs = Math.max(5_000, Math.round(opts.timeoutMs || 30_000));
  return opts;
}

function usage() {
  return `
Factory 50-run series readiness smoke (read-only).

Usage:
  node lib/factory/seriesReadinessSmoke.mjs --base-url http://127.0.0.1:3011 --niche cosmetics

Options:
  --base-url <url>       Default: ${DEFAULT_BASE_URL}
  --secret <token>       Optional bearer token / CRON_SECRET
  --niche <name>         Optional niche filter
  --series-after <iso>   Start a fresh 50-run window after this timestamp
  --target-runs <n>      Default: 50
  --batch-size <n>       Default: 5
  --timeout-ms <n>       Default: 30000
  --json-out <path>      Default: ${DEFAULT_JSON_OUT}
  --md-out <path>        Default: ${DEFAULT_MD_OUT}
  --json                 Print JSON payload
`.trim();
}

function headers(secret) {
  const h = { Accept: "application/json" };
  if (secret) h.Authorization = `Bearer ${secret}`;
  return h;
}

async function writeMaybe(filePath, content) {
  if (!filePath) return;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function fetchReadiness(opts) {
  const url = new URL(`${opts.baseUrl}/api/factory/series-readiness`);
  if (opts.niche) url.searchParams.set("niche", opts.niche);
  if (opts.seriesAfter) url.searchParams.set("series_after", opts.seriesAfter);
  url.searchParams.set("target_runs", String(opts.targetRuns));
  url.searchParams.set("batch_size", String(opts.batchSize));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { headers: headers(opts.secret), signal: controller.signal });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { ok: false, error: `non-json response: ${text.slice(0, 180)}` }; }
    return { status: res.status, url: url.toString(), body };
  } finally {
    clearTimeout(timer);
  }
}

function buildMarkdown(payload) {
  const b = payload.body || {};
  const s = b.series_state || {};
  const gate = b.next_batch_gate || {};
  const lines = [
    "# Factory Series Readiness",
    "",
    `- generated_at: ${payload.generated_at}`,
    `- endpoint: ${payload.endpoint}`,
    `- http_status: ${payload.status}`,
    `- ok: ${b.ok === true ? "yes" : "no"}`,
    `- series_start_at: ${b.series_start_at || ""}`,
    `- ready_to_launch_next: ${b.ready_to_launch_next ? "yes" : "no"}`,
    `- blockers: ${Array.isArray(b.blockers) && b.blockers.length ? b.blockers.join(" | ") : "none"}`,
    `- completed_batches: ${s.completed_batches ?? ""}/${s.target_batches ?? ""}`,
    `- next_batch_index: ${s.next_batch_index ?? ""}`,
    `- remaining_runs: ${s.remaining_runs ?? ""}`,
    `- feedback_queue_count: ${b.feedback_queue_count ?? ""}`,
    `- gate: ${gate.ready ? "ready" : "hold"} · ${gate.reason || ""}`,
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
  const result = await fetchReadiness(opts);
  const payload = { generated_at: new Date().toISOString(), endpoint: result.url, status: result.status, body: result.body };
  await writeMaybe(opts.jsonOut, JSON.stringify(payload, null, 2) + "\n");
  await writeMaybe(opts.mdOut, buildMarkdown(payload));
  if (opts.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(`${result.body?.ready_to_launch_next ? "ready" : "hold"} · ${Array.isArray(result.body?.blockers) ? result.body.blockers.join(" | ") : result.body?.error || ""}`);
  if (!result.body?.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`series readiness smoke failed: ${String(err?.message || err).slice(0, 240)}`);
  process.exitCode = 1;
});
