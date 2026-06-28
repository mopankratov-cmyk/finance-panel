#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://finance-panel-two.vercel.app";
const DEFAULT_RECIPE_ID = 68;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_JSON_OUT = "docs/factory-latest-prod-smoke.json";
const DEFAULT_MD_OUT = "docs/factory-latest-prod-smoke.md";
const DEFAULT_ARCHIVE_DIR = "docs/factory-prod-smoke-history";

function usage() {
  return `
Factory production-truth smoke.

Required:
  CRON_SECRET=... node lib/factory/prodSmoke.mjs

Options:
  --base-url <url>           Default: ${DEFAULT_BASE_URL}
  --secret <token>           Override CRON_SECRET without printing it
  --recipe <id>              Default: ${DEFAULT_RECIPE_ID}
  --timeout-ms <n>           Default: ${DEFAULT_TIMEOUT_MS}
  --trigger-run              Also POST /api/factory/graph-run after read-only checks
  --restart-run              Include restart:true when --trigger-run is used
  --json-out <path>          Default: ${DEFAULT_JSON_OUT}
  --md-out <path>            Default: ${DEFAULT_MD_OUT}
  --archive-dir <path>       Default: ${DEFAULT_ARCHIVE_DIR}
  --archive false            Disable timestamped archive artifacts
  --json                     Print full JSON payload to stdout
`.trim();
}

function readFlag(args, index) {
  const arg = args[index];
  const eq = arg.indexOf("=");
  if (eq !== -1) return { value: arg.slice(eq + 1), next: index + 1 };
  return { value: args[index + 1], next: index + 2 };
}

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.BASE_URL || DEFAULT_BASE_URL,
    secret: process.env.CRON_SECRET || "",
    recipeId: DEFAULT_RECIPE_ID,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    triggerRun: false,
    restartRun: false,
    jsonOut: process.env.FACTORY_PROD_SMOKE_JSON_OUT || DEFAULT_JSON_OUT,
    mdOut: process.env.FACTORY_PROD_SMOKE_MD_OUT || DEFAULT_MD_OUT,
    archiveDir: process.env.FACTORY_PROD_SMOKE_ARCHIVE_DIR || DEFAULT_ARCHIVE_DIR,
    archive: String(process.env.FACTORY_PROD_SMOKE_ARCHIVE || "true") !== "false",
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length;) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      i += 1;
      continue;
    }
    if (arg === "--trigger-run") {
      opts.triggerRun = true;
      i += 1;
      continue;
    }
    if (arg === "--restart-run") {
      opts.restartRun = true;
      i += 1;
      continue;
    }
    if (arg === "--json") {
      opts.json = true;
      i += 1;
      continue;
    }
    if (arg.startsWith("--base-url")) {
      const read = readFlag(argv, i);
      opts.baseUrl = String(read.value || "").trim() || opts.baseUrl;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--secret")) {
      const read = readFlag(argv, i);
      opts.secret = String(read.value || "").trim();
      i = read.next;
      continue;
    }
    if (arg.startsWith("--recipe")) {
      const read = readFlag(argv, i);
      const recipeId = Number(read.value);
      opts.recipeId = Number.isFinite(recipeId) ? Math.max(1, Math.round(recipeId)) : opts.recipeId;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--timeout-ms")) {
      const read = readFlag(argv, i);
      const timeoutMs = Number(read.value);
      opts.timeoutMs = Number.isFinite(timeoutMs) ? Math.max(5_000, Math.round(timeoutMs)) : opts.timeoutMs;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--json-out")) {
      const read = readFlag(argv, i);
      opts.jsonOut = String(read.value || "").trim() || opts.jsonOut;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--md-out")) {
      const read = readFlag(argv, i);
      opts.mdOut = String(read.value || "").trim() || opts.mdOut;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--archive-dir")) {
      const read = readFlag(argv, i);
      opts.archiveDir = String(read.value || "").trim() || opts.archiveDir;
      i = read.next;
      continue;
    }
    if (arg.startsWith("--archive")) {
      const read = readFlag(argv, i);
      opts.archive = String(read.value || "true") !== "false";
      i = read.next;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  opts.baseUrl = opts.baseUrl.replace(/\/+$/, "");
  return opts;
}

function authHeaders(secret, json = false) {
  const headers = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

function previewText(value, max = 220) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function classifyIssue({ status, body, error, route }) {
  const message = String(
    error
      || body?.error
      || body?.detail
      || body?.diagnostics?.detail
      || body?.ops_status?.summary
      || ""
  ).toLowerCase();

  if (status === 401 || message.includes("unauthorized") || message.includes("не авториз")) return "auth";
  if (message.includes("queue fallback") || message.includes("sender_missing") || message.includes("table_missing") || message.includes("db_permissions")) return "worker_infra";
  if (message.includes("upstream_unavailable") || message.includes("provider") || message.includes("claude")) return "provider";
  if (message.includes("observability") || route.includes("/stability")) return "observability";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("abort")) return "runtime";
  if (message.includes("db") || message.includes("supabase") || message.includes("schema cache")) return "runtime";
  if (status >= 500) return "runtime";
  return "ok";
}

function classifyOverall(results) {
  const failed = results.filter((result) => !result.ok);
  if (!failed.length) return "pass";
  if (failed.some((result) => result.classification === "auth")) return "blocked_by_auth";
  if (failed.some((result) => result.classification === "runtime")) return "runtime_issue";
  if (failed.some((result) => result.classification === "provider")) return "provider_issue";
  if (failed.some((result) => result.classification === "worker_infra")) return "worker_infra_issue";
  if (failed.some((result) => result.classification === "observability")) return "observability_issue";
  return "mixed_failures";
}

async function requestJson(url, init, timeoutMs) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { status: res.status, ok: res.ok, body, text };
}

async function runCheck(definition, opts) {
  const startedAt = new Date().toISOString();
  const target = `${opts.baseUrl}${definition.path}`;
  try {
    const response = await requestJson(target, {
      method: definition.method,
      headers: authHeaders(opts.secret, definition.method !== "GET"),
      body: definition.body ? JSON.stringify(definition.body) : undefined,
    }, opts.timeoutMs);

    const classification = response.ok
      ? "ok"
      : classifyIssue({ status: response.status, body: response.body, route: definition.path });

    return {
      name: definition.name,
      route: definition.path,
      method: definition.method,
      started_at: startedAt,
      status: response.status,
      ok: response.ok,
      classification,
      detail: response.ok
        ? definition.detail(response.body)
        : previewText(response.body?.error || response.body?.detail || response.text),
      body: response.body,
    };
  } catch (error) {
    return {
      name: definition.name,
      route: definition.path,
      method: definition.method,
      started_at: startedAt,
      status: 0,
      ok: false,
      classification: classifyIssue({ status: 0, error: String(error?.message || error), route: definition.path }),
      detail: previewText(String(error?.message || error)),
      body: null,
    };
  }
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

function buildMarkdown(payload) {
  const lines = [
    "# Factory Production Smoke",
    "",
    `- generated_at: ${payload.generated_at}`,
    `- base_url: ${payload.base_url}`,
    `- recipe_id: ${payload.recipe_id}`,
    `- overall: ${payload.overall}`,
    `- failed_checks: ${payload.summary.failed_checks}/${payload.summary.total_checks}`,
    `- auth_failures: ${payload.summary.auth_failures}`,
    `- runtime_failures: ${payload.summary.runtime_failures}`,
    `- worker_infra_failures: ${payload.summary.worker_infra_failures}`,
    `- observability_failures: ${payload.summary.observability_failures}`,
    `- provider_failures: ${payload.summary.provider_failures}`,
    "",
    "## Checks",
    "",
  ];

  for (const check of payload.checks) {
    lines.push(`- ${check.name}: ${check.ok ? "ok" : "fail"} · ${check.method} ${check.route} · class=${check.classification} · ${check.detail}`);
  }

  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push("- `auth` = production guard/session/CRON secret mismatch");
  lines.push("- `runtime` = route crashed, timed out, or broke on DB/runtime path");
  lines.push("- `worker_infra` = heartbeat/queue fallback path is noisy, but this is not automatically an MP4 execution failure");
  lines.push("- `observability` = read-only status layer is degraded");
  lines.push("- `provider` = upstream AI/media provider path is degraded");
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }
  if (!opts.secret) {
    console.error("CRON_SECRET is required. Pass it via env or --secret; the script never prints it.");
    process.exit(2);
  }

  const checks = [
    {
      name: "ops",
      method: "GET",
      path: "/api/factory/ops",
      detail(body) {
        return body?.ops_status?.level
          ? `ops_status=${body.ops_status.level}${body.ops_status.summary ? ` (${body.ops_status.summary})` : ""}`
          : "ops snapshot returned";
      },
    },
    {
      name: "worker_state",
      method: "GET",
      path: "/api/factory/worker-state",
      detail(body) {
        return body?.worker?.status
          ? `worker=${body.worker.status} source=${body.worker.source || "unknown"}`
          : body?.db_error
            ? `db_error=${previewText(body.db_error, 120)}`
            : "worker snapshot returned";
      },
    },
    {
      name: "stability",
      method: "GET",
      path: "/api/factory/stability",
      detail(body) {
        return body?.stability
          ? `success_streak=${body.stability.success_streak || 0} target_met=${body.stability.target_met ? "yes" : "no"}`
          : body?.error
            ? previewText(body.error, 120)
            : "stability snapshot returned";
      },
    },
    {
      name: "graph_run_read",
      method: "GET",
      path: `/api/factory/graph-run?recipe_id=${opts.recipeId}`,
      detail(body) {
        return body?.step
          ? `status=${body.status || "unknown"} step=${body.step}`
          : body?.error
            ? previewText(body.error, 120)
            : "graph-run snapshot returned";
      },
    },
  ];

  if (opts.triggerRun) {
    checks.push({
      name: "graph_run_post",
      method: "POST",
      path: "/api/factory/graph-run",
      body: { recipe_id: opts.recipeId, restart: opts.restartRun },
      detail(body) {
        return body?.ok ? `started recipe_id=${body.recipe_id}` : previewText(body?.error || "graph-run POST returned");
      },
    });
  }

  const results = [];
  for (const check of checks) {
    const result = await runCheck(check, opts);
    results.push(result);
    console.log(`${result.ok ? "OK" : "FAIL"} ${result.name} ${result.status} ${result.classification} ${result.detail}`);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    base_url: opts.baseUrl,
    recipe_id: opts.recipeId,
    overall: classifyOverall(results),
    summary: {
      total_checks: results.length,
      failed_checks: results.filter((result) => !result.ok).length,
      auth_failures: results.filter((result) => result.classification === "auth").length,
      runtime_failures: results.filter((result) => result.classification === "runtime").length,
      worker_infra_failures: results.filter((result) => result.classification === "worker_infra").length,
      observability_failures: results.filter((result) => result.classification === "observability").length,
      provider_failures: results.filter((result) => result.classification === "provider").length,
    },
    checks: results,
  };

  const json = JSON.stringify(payload, null, 2) + "\n";
  const markdown = buildMarkdown(payload);
  await writeMaybe(opts.jsonOut, json);
  await writeMaybe(opts.mdOut, markdown);
  if (opts.archive && opts.archiveDir) {
    const slug = archiveSlug(new Date(payload.generated_at));
    await writeMaybe(path.join(opts.archiveDir, `${slug}.json`), json);
    await writeMaybe(path.join(opts.archiveDir, `${slug}.md`), markdown);
  }

  console.log(`SUMMARY ${JSON.stringify({ overall: payload.overall, failed_checks: payload.summary.failed_checks, total_checks: payload.summary.total_checks })}`);
  if (opts.json) console.log(json);
  if (payload.summary.failed_checks > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
