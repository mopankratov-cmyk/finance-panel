#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://finance-panel-two.vercel.app";
const DEFAULT_JSON_OUT = "docs/factory-latest-no-paid-smoke.json";
const DEFAULT_MD_OUT = "docs/factory-latest-no-paid-smoke.md";

function readFlag(args, index) {
  const arg = args[index];
  const eq = arg.indexOf("=");
  if (eq !== -1) return { value: arg.slice(eq + 1), next: index + 1 };
  return { value: args[index + 1], next: index + 2 };
}

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.BASE_URL || process.env.FACTORY_NO_PAID_BASE_URL || DEFAULT_BASE_URL,
    secret: process.env.CRON_SECRET || "",
    niche: process.env.FACTORY_NO_PAID_NICHE || "",
    hours: Number(process.env.FACTORY_NO_PAID_HOURS || 72),
    count: Number(process.env.FACTORY_NO_PAID_COUNT || 5),
    budgetUsd: Number(process.env.FACTORY_NO_PAID_BUDGET_USD || 20),
    seriesAfter: process.env.FACTORY_SERIES_AFTER || "",
    timeoutMs: Number(process.env.FACTORY_NO_PAID_TIMEOUT_MS || 45_000),
    jsonOut: process.env.FACTORY_NO_PAID_JSON_OUT || DEFAULT_JSON_OUT,
    mdOut: process.env.FACTORY_NO_PAID_MD_OUT || DEFAULT_MD_OUT,
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
    if (arg.startsWith("--hours")) { const r = readFlag(argv, i); opts.hours = Number(r.value) || opts.hours; i = r.next; continue; }
    if (arg.startsWith("--count")) { const r = readFlag(argv, i); opts.count = Number(r.value) || opts.count; i = r.next; continue; }
    if (arg.startsWith("--budget-usd")) { const r = readFlag(argv, i); opts.budgetUsd = Number(r.value) || opts.budgetUsd; i = r.next; continue; }
    if (arg.startsWith("--series-after")) { const r = readFlag(argv, i); opts.seriesAfter = String(r.value || ""); i = r.next; continue; }
    if (arg.startsWith("--timeout-ms")) { const r = readFlag(argv, i); opts.timeoutMs = Number(r.value) || opts.timeoutMs; i = r.next; continue; }
    if (arg.startsWith("--json-out")) { const r = readFlag(argv, i); opts.jsonOut = String(r.value || ""); i = r.next; continue; }
    if (arg.startsWith("--md-out")) { const r = readFlag(argv, i); opts.mdOut = String(r.value || ""); i = r.next; continue; }
    throw new Error(`Unknown argument: ${arg}`);
  }
  opts.baseUrl = String(opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  opts.hours = Math.max(1, Math.min(24 * 30, Math.round(opts.hours || 72)));
  opts.count = Math.max(2, Math.min(10, Math.round(opts.count || 5)));
  opts.budgetUsd = Math.max(1, Math.round((opts.budgetUsd || 20) * 100) / 100);
  opts.timeoutMs = Math.max(5_000, Math.round(opts.timeoutMs || 45_000));
  return opts;
}

function usage() {
  return `
Factory no-paid readiness smoke.

Usage:
  CRON_SECRET=... node lib/factory/noPaidReadinessSmoke.mjs --niche cosmetics

Checks:
  GET /balances
  GET /quality
  GET /quality-diagnostics
  GET /memory-quality
  GET /feedback-queue
  POST /feedback-queue/auto with apply:false
  GET /series-readiness
  POST /batch with dry_run:true

It never launches generation and never calls FAL render/source-prep endpoints.
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

async function requestJson(name, url, init, timeoutMs) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    const raw = await res.text();
    let body;
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { ok: false, raw: raw.slice(0, 500) }; }
    return { name, url, status: res.status, ok: res.ok, body };
  } catch (e) {
    return { name, url, status: 0, ok: false, body: { ok: false, error: String(e?.message || e).slice(0, 240) } };
  }
}

function urlWithParams(base, pathName, params) {
  const url = new URL(`${base}${pathName}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function runChecks(opts) {
  const common = { method: "GET", headers: headers(opts.secret) };
  const seriesParams = { niche: opts.niche, target_runs: 50, batch_size: opts.count, series_after: opts.seriesAfter };
  const checks = {};
  checks.balances = await requestJson("balances", `${opts.baseUrl}/api/factory/balances`, common, opts.timeoutMs);
  checks.quality = await requestJson("quality", urlWithParams(opts.baseUrl, "/api/factory/quality", { hours: opts.hours, niche: opts.niche }), common, opts.timeoutMs);
  checks.diagnostics = await requestJson("quality-diagnostics", urlWithParams(opts.baseUrl, "/api/factory/quality-diagnostics", { hours: opts.hours, niche: opts.niche }), common, opts.timeoutMs);
  checks.memory = await requestJson("memory-quality", `${opts.baseUrl}/api/factory/memory-quality`, common, opts.timeoutMs);
  checks.feedback = await requestJson("feedback-queue", urlWithParams(opts.baseUrl, "/api/factory/feedback-queue", { limit: 12, niche: opts.niche }), common, opts.timeoutMs);
  checks.autoFeedback = await requestJson("feedback-queue-auto", `${opts.baseUrl}/api/factory/feedback-queue/auto`, {
    method: "POST",
    headers: headers(opts.secret, true),
    body: JSON.stringify({ apply: false, limit: 500, niche: opts.niche || null }),
  }, opts.timeoutMs);
  checks.series = await requestJson("series-readiness", urlWithParams(opts.baseUrl, "/api/factory/series-readiness", seriesParams), common, opts.timeoutMs);
  checks.batch = await requestJson("batch-dry-run", `${opts.baseUrl}/api/factory/batch`, {
    method: "POST",
    headers: headers(opts.secret, true),
    body: JSON.stringify({
      niche: opts.niche || null,
      count: opts.count,
      budget_usd: opts.budgetUsd,
      dry_run: true,
      require_full_batch: true,
      require_learning_gate: true,
      require_strong_source: true,
      ...(opts.seriesAfter ? { series_after: opts.seriesAfter } : {}),
    }),
  }, opts.timeoutMs);
  return checks;
}

function summarize(checks) {
  const blockers = [];
  const warnings = [];
  const balances = checks.balances?.body?.balances || checks.balances?.body?.services || [];
  const fal = Array.isArray(balances) ? balances.find((row) => row?.service === "fal") : null;
  if (fal?.low === true) blockers.push(`fal balance low: ${fal.balance} ${fal.currency || ""}`.trim());
  const diagnostics = checks.diagnostics?.body?.diagnostics || {};
  for (const blocker of diagnostics.blockers || []) blockers.push(blocker);
  const batch = checks.batch?.body || {};
  if (checks.batch?.status === 409 && Array.isArray(batch.balance_block)) blockers.push(`batch balance_block: ${batch.balance_block.join(",")}`);
  else if (batch.preflight?.ready === false) blockers.push("batch preflight not ready");
  if (checks.series?.body?.ready_to_launch_next === false) warnings.push(`series hold: ${(checks.series.body.blockers || []).join(" | ")}`);
  if (checks.memory?.body?.summary?.by_label?.winner === 0) blockers.push("memory has 0 winner videos");
  const feedbackCount = Number(checks.feedback?.body?.total_candidates || checks.feedback?.body?.queue?.length || 0);
  if (feedbackCount > 0) warnings.push(`${feedbackCount} videos await operator winner/reject feedback`);
  const autoWinner = Number(checks.autoFeedback?.body?.by_action?.winner || 0);
  const autoTrash = Number(checks.autoFeedback?.body?.by_action?.trash || 0);
  if (autoWinner > 0 || autoTrash > 0) warnings.push(`auto-feedback dry-run: winner ${autoWinner}, trash ${autoTrash}`);
  const uniqueBlockers = Array.from(new Set(blockers.filter(Boolean)));
  const uniqueWarnings = Array.from(new Set(warnings.filter(Boolean)));
  return {
    ready_for_paid_batch: uniqueBlockers.length === 0 && batch?.preflight?.ready === true,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
  };
}

function buildMarkdown(payload) {
  const s = payload.summary || {};
  const q = payload.checks.quality?.body?.quality || {};
  const d = payload.checks.diagnostics?.body?.diagnostics || {};
  const m = payload.checks.memory?.body || {};
  const f = payload.checks.feedback?.body || {};
  const af = payload.checks.autoFeedback?.body || {};
  const b = payload.checks.batch?.body || {};
  const balances = payload.checks.balances?.body?.balances || payload.checks.balances?.body?.services || [];
  const fal = Array.isArray(balances) ? balances.find((row) => row?.service === "fal") : null;
  const lines = [
    "# Factory No-Paid Readiness Smoke",
    "",
    `- generated_at: ${payload.generated_at}`,
    `- base_url: ${payload.base_url}`,
    `- niche: ${payload.niche || ""}`,
    `- ready_for_paid_batch: ${s.ready_for_paid_batch ? "yes" : "no"}`,
    `- blockers: ${s.blockers?.length ? s.blockers.join(" | ") : "none"}`,
    `- warnings: ${s.warnings?.length ? s.warnings.join(" | ") : "none"}`,
    "",
    "## Quality",
    "",
    `- produced_videos: ${q.produced_videos ?? ""}`,
    `- otk_pass: ${q.otk_pass ?? ""}`,
    `- pass_rate: ${q.pass_rate ?? ""}`,
    `- bank_rate: ${q.bank_rate ?? ""}`,
    `- top_warning: ${d.warning_counts?.[0]?.reason || ""} (${d.warning_counts?.[0]?.count || 0})`,
    "",
    "## Memory",
    "",
    `- total: ${m.total ?? ""}`,
    `- labels: ${JSON.stringify(m.summary?.by_label || m.by_label || {})}`,
    `- feedback_queue: ${f.total_candidates ?? f.queue?.length ?? ""}`,
    `- top_feedback_candidate: ${f.queue?.[0] ? `${f.queue[0].asset_id} · ${f.queue[0].memory_label} · priority ${f.queue[0].priority_score}` : ""}`,
    `- auto_feedback: ${af.by_action ? JSON.stringify(af.by_action) : ""}`,
    `- auto_feedback_note: ${af.note || ""}`,
    "",
    "## Readiness",
    "",
    `- fal: ${fal ? `${fal.balance} ${fal.currency || ""} low=${fal.low}` : "unknown"}`,
    `- batch_status: ${payload.checks.batch?.status ?? ""}`,
    `- preflight_ready: ${b.preflight?.ready ? "yes" : "no"}`,
    `- source_tiers: ${JSON.stringify(b.preflight?.source_tiers || d.source_tiers || {})}`,
    `- next_action: ${b.next_action ? JSON.stringify(b.next_action) : ""}`,
    "",
    "## Next Actions",
    "",
    ...(d.next_actions || []).map((item) => `- ${item}`),
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
  const checks = await runChecks(opts);
  const payload = {
    generated_at: new Date().toISOString(),
    base_url: opts.baseUrl,
    niche: opts.niche || null,
    hours: opts.hours,
    count: opts.count,
    budget_usd: opts.budgetUsd,
    checks,
    summary: summarize(checks),
  };
  await writeMaybe(opts.jsonOut, JSON.stringify(payload, null, 2) + "\n");
  await writeMaybe(opts.mdOut, buildMarkdown(payload));
  if (opts.json) console.log(JSON.stringify(payload, null, 2));
  else console.log(`${payload.summary.ready_for_paid_batch ? "ready" : "hold"} · blockers: ${payload.summary.blockers.join(" | ") || "none"}`);
  if (!payload.summary.ready_for_paid_batch) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`no-paid readiness smoke failed: ${String(err?.message || err).slice(0, 240)}`);
  process.exitCode = 1;
});
