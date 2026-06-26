#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith("--")) continue;
  const next = process.argv[i + 1];
  args.set(key.slice(2), next && !next.startsWith("--") ? next : "true");
  if (next && !next.startsWith("--")) i += 1;
}

const base = String(args.get("base") || process.env.FACTORY_STRESS_BASE || "http://127.0.0.1:3011").replace(/\/$/, "");
const recipeId = Number(args.get("recipe") || process.env.FACTORY_STRESS_RECIPE_ID || 68);
const runs = Number(args.get("runs") || process.env.FACTORY_STRESS_RUNS || 10);
const pollMs = Number(args.get("poll-ms") || process.env.FACTORY_STRESS_POLL_MS || 3000);
const maxPolls = Number(args.get("max-polls") || process.env.FACTORY_STRESS_MAX_POLLS || 80);
const maxWaitSec = Math.round((pollMs * maxPolls) / 1000);
const requestTimeoutRaw = Number(args.get("request-timeout-ms") || process.env.FACTORY_STRESS_REQUEST_TIMEOUT_MS || 45_000);
const requestTimeoutMs = Number.isFinite(requestTimeoutRaw) ? Math.max(5_000, requestTimeoutRaw) : 45_000;
const requestRetriesRaw = Number(args.get("request-retries") || process.env.FACTORY_STRESS_REQUEST_RETRIES || 12);
const requestRetries = Number.isFinite(requestRetriesRaw) ? Math.max(1, Math.floor(requestRetriesRaw)) : 12;
const secret = process.env.CRON_SECRET || "";
const includeStability = String(args.get("include-stability") || "true") !== "false";
const latestMode = String(args.get("latest") || process.env.FACTORY_STRESS_LATEST || "true") !== "false";
const archiveMode = String(args.get("archive") || process.env.FACTORY_STRESS_ARCHIVE || "true") !== "false";
const archiveDir = String(args.get("archive-dir") || process.env.FACTORY_STRESS_ARCHIVE_DIR || "docs/factory-stress-history").trim();
const jsonOut = String(args.get("json-out") || process.env.FACTORY_STRESS_JSON_OUT || (latestMode ? "docs/factory-latest-stress.json" : "")).trim();
const mdOut = String(args.get("md-out") || process.env.FACTORY_STRESS_MD_OUT || (latestMode ? "docs/factory-latest-stress.md" : "")).trim();

if (!recipeId || !Number.isFinite(recipeId)) {
  throw new Error("Pass --recipe <id> or FACTORY_STRESS_RECIPE_ID");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function headers(json = false) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (secret) h.Authorization = `Bearer ${secret}`;
  return h;
}

async function fetchJson(url, options) {
  let lastErr;
  for (let i = 0; i < requestRetries; i += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON from ${url}: ${text.slice(0, 180)}`);
      }
      if (!res.ok) {
        throw new Error(`${url} ${res.status}: ${data.error || data.detail || text.slice(0, 180)}`);
      }
      return data;
    } catch (err) {
      lastErr = err;
      await sleep(1000 * (i + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function writeMaybe(filePath, content) {
  if (!filePath) return;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

function archiveSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function isAuthError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes(" 401:") || msg.includes(" 403:") || msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("не авторизовано");
}

function buildMarkdownReport(payload) {
  const summary = payload.summary || {};
  const stability = payload.stability && payload.stability.stability ? payload.stability.stability : null;
  const results = Array.isArray(payload.results) ? payload.results : [];
  const stressTargetMet = summary.completed === summary.totalRuns && !summary.failed && !summary.runFail && !summary.timeouts && !summary.authFailures;
  const lines = [
    "# Stress Run Report",
    "",
    `- generated_at: ${payload.generatedAt || new Date().toISOString()}`,
    `- base: ${summary.base || ""}`,
    `- recipe_id: ${summary.recipeId || ""}`,
    `- total_runs: ${summary.totalRuns || 0}`,
    `- completed: ${summary.completed || 0}`,
    `- failed: ${summary.failed || 0}`,
    `- warnings: ${summary.warnings || 0}`,
    `- run_fail: ${summary.runFail || 0}`,
    `- auth_fail: ${summary.authFailures || 0}`,
    `- timeouts: ${summary.timeouts || 0}`,
    `- timeout_budget_sec: ${summary.timeoutBudgetSec || 0}`,
    `- avg_duration_sec: ${summary.avgDurationSec || 0}`,
    `- stress_target_met: ${stressTargetMet ? "yes" : "no"}`,
    "",
  ];
  if (stability) {
    lines.push("## DB Stability Snapshot", "");
    lines.push("- note: this is a database-wide recent-runs snapshot; it can include older failures outside this stress run");
    lines.push(`- success_streak: ${stability.success_streak || 0}`);
    lines.push(`- successful_runs: ${stability.successful_runs || 0}/${stability.window_size || 10}`);
    lines.push(`- db_target_met: ${stability.target_met ? "yes" : "no"}`);
    if (stability.failure_diagnostics) {
      lines.push(`- failure_issue: ${stability.failure_diagnostics.issue || ""}`);
    }
    lines.push("");
  }
  lines.push("## Runs", "");
  results.forEach((r) => {
    lines.push(`- #${r.index}: ${r.status}/${r.step} · ${r.durationSec}s${r.error ? ` · error: ${r.error}` : ""}`);
  });
  lines.push("");
  return lines.join("\n");
}

async function runOnce(index) {
  const t0 = Date.now();
  let last = null;
  try {
    await fetchJson(`${base}/api/factory/graph-run`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ recipe_id: recipeId, restart: true }),
    });

    for (let poll = 0; poll < maxPolls; poll += 1) {
      await sleep(pollMs);
      const s = await fetchJson(`${base}/api/factory/graph-run?recipe_id=${recipeId}`, { headers: headers(false) });
      last = s;
      if (s.step === "done" || s.step === "failed") {
        const executionLog = Array.isArray(s.execution_log) ? s.execution_log : [];
        return {
          index,
          durationSec: Math.round((Date.now() - t0) / 1000),
          status: s.status,
          step: s.step,
          warningCount: Array.isArray(s.warnings) ? s.warnings.length : 0,
          warnings: s.warnings || [],
          runId: s.run_id || null,
          executionLogCount: executionLog.filter((e) => e.run_id === s.run_id).length,
          outputUrl: s.output_url || null,
          error: s.error || null,
        };
      }
    }
  } catch (err) {
    const executionLog = Array.isArray(last?.execution_log) ? last.execution_log : [];
    const error = String(err?.message || err).slice(0, 240);
    const authFailure = isAuthError(err);
    return {
      index,
      durationSec: Math.round((Date.now() - t0) / 1000),
      status: authFailure ? "auth_fail" : "run_fail",
      step: authFailure ? "blocked" : "failed",
      warningCount: Array.isArray(last?.warnings) ? last.warnings.length : 0,
      warnings: last?.warnings || [],
      runId: last?.run_id || null,
      executionLogCount: executionLog.filter((e) => e.run_id === last?.run_id).length,
      outputUrl: last?.output_url || null,
      error,
    };
  }

  const executionLog = Array.isArray(last?.execution_log) ? last.execution_log : [];
  return {
    index,
    durationSec: Math.round((Date.now() - t0) / 1000),
    status: "timeout",
    step: last?.step || "timeout",
    lastStatus: last?.status || null,
    warningCount: Array.isArray(last?.warnings) ? last.warnings.length : 0,
    warnings: last?.warnings || [],
    runId: last?.run_id || null,
    executionLogCount: executionLog.filter((e) => e.run_id === last?.run_id).length,
    outputUrl: last?.output_url || null,
    error: `timeout waiting for completion after ${maxWaitSec}s`,
  };
}

const results = [];
for (let i = 1; i <= runs; i += 1) {
  console.log("RUN_START " + JSON.stringify({ index: i, totalRuns: runs, base, recipeId, at: new Date().toISOString() }));
  const result = await runOnce(i);
  results.push(result);
  console.log(JSON.stringify(result));
}

const summary = {
  base,
  recipeId,
  totalRuns: runs,
  completed: results.filter((r) => r.step === "done").length,
  failed: results.filter((r) => r.step === "failed").length,
  warnings: results.filter((r) => r.status === "warning").length,
  otkFail: results.filter((r) => r.status === "otk_fail").length,
  runFail: results.filter((r) => r.status === "run_fail").length,
  authFailures: results.filter((r) => r.status === "auth_fail").length,
  timeouts: results.filter((r) => r.status === "timeout" || String(r.error || "").startsWith("timeout waiting for completion")).length,
  timeoutBudgetSec: maxWaitSec,
  avgDurationSec: Math.round(results.reduce((acc, r) => acc + r.durationSec, 0) / Math.max(1, results.length)),
};
summary.targetMet = summary.completed === summary.totalRuns && !summary.failed && !summary.runFail && !summary.timeouts && !summary.authFailures;

console.log("SUMMARY " + JSON.stringify(summary));
let stabilityPayload = null;
if (includeStability) {
  try {
    stabilityPayload = await fetchJson(`${base}/api/factory/stability`, { headers: headers(false) });
    console.log("STABILITY " + JSON.stringify(stabilityPayload));
  } catch (err) {
    stabilityPayload = { ok: false, error: String(err && err.message ? err.message : err) };
    console.log("STABILITY " + JSON.stringify(stabilityPayload));
  }
}
const reportPayload = {
  generatedAt: new Date().toISOString(),
  summary,
  stability: stabilityPayload,
  results,
};
const jsonReport = JSON.stringify(reportPayload, null, 2) + "\n";
const mdReport = buildMarkdownReport(reportPayload);
await writeMaybe(jsonOut, jsonReport);
await writeMaybe(mdOut, mdReport);
if (archiveMode && archiveDir) {
  const slug = archiveSlug(new Date(reportPayload.generatedAt));
  await writeMaybe(path.join(archiveDir, `${slug}.json`), jsonReport);
  await writeMaybe(path.join(archiveDir, `${slug}.md`), mdReport);
}
if (summary.completed !== runs || summary.failed || summary.runFail || summary.timeouts || summary.authFailures) {
  process.exitCode = 1;
}
