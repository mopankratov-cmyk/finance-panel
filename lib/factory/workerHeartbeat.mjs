#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const opts = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > 0) {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      opts[arg.slice(2)] = next;
      i += 1;
    } else {
      opts[arg.slice(2)] = true;
    }
  }
  return opts;
}

function toText(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  const wrapped = text.match(/^`([^`]+)`$/);
  return wrapped ? wrapped[1].trim() : text;
}

function usage() {
  console.log(`Usage:
  BASE_URL=https://your-domain CRON_SECRET=... node lib/factory/workerHeartbeat.mjs --once
  BASE_URL=https://your-domain CRON_SECRET=... node lib/factory/workerHeartbeat.mjs --every-sec=120

Options:
  --base <url>              Override BASE_URL
  --secret <token>          Override CRON_SECRET
  --queue-file <path>       Markdown queue source
  --worker-id <id>          Worker id (default: railway-content-factory)
  --label <text>            Worker label
  --status <text>           idle|working|blocked|pr_open|done|error
  --branch <name>           Current branch
  --pr <ref>                PR number or URL
  --task-id <id>            Current task id
  --task-title <text>       Current task title
  --progress <text>         Progress message
  --blocker <text>          Blocker message
  --note <text>             Free-form note
  --no-queue                Do not send parsed queue snapshot
  --once                    Send one heartbeat and exit
  --every-sec <n>           Repeat heartbeat every n seconds
  --help                    Show this help
`);
}

function parseQueue(md) {
  const tasks = [];
  const blocks = md.split(/^### /m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const titleLine = toText(lines[0] || "");
    if (!titleLine || titleLine.toLowerCase().includes("архив")) continue;
    const task = { id: toText(titleLine.split("·")[0] || ""), title: titleLine, status: "todo", priority: "", branch: "", pr: "", blockers: [] };
    let section = "";
    for (const raw of lines.slice(1)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("- Статус:")) { task.status = toText(line.slice(9)) || task.status; section = ""; continue; }
      if (line.startsWith("- Приоритет:")) { task.priority = toText(line.slice(12)); section = ""; continue; }
      if (line.startsWith("- Ветка:")) { task.branch = toText(line.slice(8)); section = ""; continue; }
      if (line.startsWith("- PR:")) { task.pr = toText(line.slice(5)); section = ""; continue; }
      if (line.startsWith("- Блокеры:")) {
        const inline = toText(line.slice(11));
        if (inline) task.blockers.push(inline);
        section = "blockers";
        continue;
      }
      if (section === "blockers" && line.startsWith("-")) {
        task.blockers.push(toText(line.replace(/^-+\s*/, "")));
        continue;
      }
      if (!task.id && line.startsWith("- ")) {
        task.id = toText(line.replace(/^-+\s*/, "").split("·")[0] || "");
      }
    }
    tasks.push(task);
  }
  return tasks;
}

async function readQueue(queueFile) {
  try {
    const text = await fs.readFile(queueFile, "utf8");
    return parseQueue(text).slice(0, 30);
  } catch {
    return [];
  }
}

function boolFlag(value, defaultValue = false) {
  if (value == null) return defaultValue;
  if (value === true) return true;
  const text = String(value).trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const opts = parseArgs(process.argv);
if (opts.help) {
  usage();
  process.exit(0);
}

const baseUrl = String(opts.base || process.env.BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const secret = String(opts.secret || process.env.CRON_SECRET || "");
if (!baseUrl) {
  console.error("BASE_URL is required");
  process.exit(1);
}
if (!secret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

const queueFile = path.resolve(String(opts["queue-file"] || process.env.WORKER_QUEUE_FILE || "docs/factory-railway-task-queue.md"));
const workerId = toText(opts["worker-id"] || process.env.WORKER_ID || "railway-content-factory");
const label = toText(opts.label || process.env.WORKER_LABEL || "Railway worker");
const everySec = Math.max(0, Number(opts["every-sec"] || process.env.WORKER_HEARTBEAT_EVERY_SEC || 0) || 0);
const includeQueue = !boolFlag(opts["no-queue"], false);

async function buildPayload() {
  const queue = includeQueue ? await readQueue(queueFile) : [];
  const active = queue.find((task) => task.status === "doing")
    || queue.find((task) => task.status === "blocked")
    || queue.find((task) => task.status === "todo")
    || null;

  return {
    worker_id: workerId,
    label,
    status: toText(opts.status || process.env.WORKER_STATUS || (active?.status === "doing" ? "working" : active?.status || "working")),
    branch: toText(opts.branch || process.env.WORKER_BRANCH || active?.branch || ""),
    pr: toText(opts.pr || process.env.WORKER_PR || active?.pr || ""),
    current_task_id: toText(opts["task-id"] || process.env.WORKER_TASK_ID || active?.id || ""),
    current_task_title: toText(opts["task-title"] || process.env.WORKER_TASK_TITLE || active?.title || ""),
    progress: toText(opts.progress || process.env.WORKER_PROGRESS || ""),
    blocker: toText(opts.blocker || process.env.WORKER_BLOCKER || active?.blockers?.[0] || ""),
    note: toText(opts.note || process.env.WORKER_NOTE || ""),
    queue,
  };
}

async function postHeartbeat() {
  const payload = await buildPayload();
  const res = await fetch(`${baseUrl}/api/factory/worker-state`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  if (!res.ok) {
    console.error(JSON.stringify({ ok: false, status: res.status, body: json }, null, 2));
    throw new Error(`heartbeat failed: ${res.status}`);
  }
  console.log(JSON.stringify({
    ok: true,
    at: new Date().toISOString(),
    worker_id: payload.worker_id,
    task: payload.current_task_id || null,
    status: payload.status,
    response: json,
  }));
}

if (!everySec || boolFlag(opts.once, false)) {
  await postHeartbeat();
  process.exit(0);
}

while (true) {
  try {
    await postHeartbeat();
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      at: new Date().toISOString(),
      error: String(err?.message || err).slice(0, 180),
    }));
  }
  await sleep(everySec * 1000);
}
